/**
 * Context-aware autocomplete for Modelica buffers. Parse the buffer, classify
 * the cursor, scope to the document's owning class; the cursor's *context* then
 * selects which OMC query produces the candidate list:
 *
 *   context → candidate source
 *   ─────────────────────────────────────────────────────────────────────────
 *   type-reference / extends / component-type
 *                          → class names: `getClassNames` of the owning class's
 *                            children PLUS a fuzzy global `searchClassNames` on
 *                            the typed prefix.
 *   member-access (after `.`)
 *                          → resolve the head's type via the resolution layer's
 *                            component-type walk (`walkCrefType`), then
 *                            `getComponents` of that type for members. If the
 *                            head is a package, `getClassNames` of it for nested
 *                            classes.
 *   modifier-name          → `getParameterNames` of the class being modified.
 *   otherwise              → nothing (don't spam plain value references).
 *
 * The routing + OMC queries live in {@link computeCompletions}, a pure function
 * with no `vscode` import (unit-tested against a mocked client);
 * {@link ModelicaCompletionProvider} is the host wrapper. Only typed
 * `@dicode/omc-client` wrappers are used — never raw `client.call`.
 *
 * Scope: candidates cover the owning class's own children plus a global fuzzy
 * net (not the full import/extends-aware visible set); `getComponents` /
 * `getParameterNames` report a class's *own* declared members, not inherited
 * ones; and completion reflects the last *saved* buffer, so a just-typed unsaved
 * member may be missing.
 */

import * as vscode from "vscode";

import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import {
  headBeforeDot,
  modifiedTypeName,
  targetAt,
  type CursorContextKind,
  type CursorTarget,
} from "./cursor.js";
import { resolveDocumentOwner } from "./document-scope.js";
import type { ParseCache } from "./parse.js";
import type { OwningClassClient } from "./owning-class.js";
import {
  qualifyTypeReference,
  walkCrefType,
  type ResolveClient,
} from "./resolve.js";
import { OmcSync } from "./sync.js";

/** The trigger character that fires member-access completion. */
export const COMPLETION_TRIGGER_CHARACTER = ".";

/**
 * Upper bound on returned candidates. Completion lists past a few dozen entries
 * stop being useful and the round-trip cost grows, so the merged, de-duped list
 * is truncated to this many items. (VSCode itself filters by the typed prefix,
 * so this is a cost cap, not the user-visible filter.)
 */
export const MAX_COMPLETIONS = 50;

/**
 * Minimum typed-prefix length before the global fuzzy `searchClassNames` fires.
 *
 * `searchClassNames` is a global fuzzy match over *every* loaded class (a full
 * MSL is thousands), and {@link MAX_COMPLETIONS}/`cap` only trims the result
 * AFTER the round trip — so the cap bounds the payload but not OMC's work. A
 * 1-character prefix matches almost everything, making that work near-worst-case
 * on every keystroke. Requiring at least this many characters keeps the cost
 * bounded where the cap can't reach. The cheap, scoped `getClassNames` (the
 * owning class's own children) still runs for short prefixes, so local names are
 * never withheld.
 */
export const MIN_FUZZY_PREFIX = 2;

/**
 * What a candidate *is*, decoupled from `vscode.CompletionItemKind` so the pure
 * core has no `vscode` dependency. {@link toVscodeCompletionKind} maps these to
 * the editor enum in the thin provider.
 */
export enum CompletionCandidateKind {
  /** A class/type name (model, block, record, …). */
  Class = "class",
  /** A component / member instance of a class. */
  Field = "field",
  /** A parameter / modifiable name. */
  Property = "property",
}

/** A single completion candidate, as plain data (no `vscode` types). */
export interface CompletionCandidate {
  /** The text shown in the list (may be a fully-qualified dotted name). */
  readonly label: string;
  /** What the candidate is, driving the icon shown. */
  readonly kind: CompletionCandidateKind;
  /** Optional secondary text (e.g. the member's type). */
  readonly detail?: string;
  /**
   * Optional text VSCode filters the candidate by against the typed prefix.
   * Set when {@link label} is a dotted name (the embedded dots break VSCode's
   * default word-based filtering); left unset to keep the default (filter by
   * the label) for bare simple-name candidates.
   */
  readonly filterText?: string;
  /**
   * Optional text inserted when the candidate is accepted, when it differs from
   * {@link label} (e.g. inserting a dotted class's simple name, not its FQN).
   */
  readonly insertText?: string;
}

/**
 * OMC surface the completion sources need: the resolution calls (via
 * {@link ResolveClient}, reused for the member-access head walk) plus the four
 * typed candidate-source wrappers. `OmcClient` satisfies this, so real call
 * sites pass it unchanged.
 */
export interface CompletionClient extends ResolveClient {
  getClassNames(input: {
    typeName?: string;
    qualified?: boolean;
  }): Promise<{ classNames: string[] }>;
  searchClassNames(input: {
    searchText: string;
  }): Promise<{ classNames: string[] }>;
  getParameterNames(input: { typeName: string }): Promise<{
    parameters: string[];
  }>;
  isPackage(input: { typeName: string }): Promise<{ b: boolean }>;
}

/** Context kinds that complete to class/type names. */
const TYPE_CONTEXTS: ReadonlySet<CursorContextKind> = new Set<CursorContextKind>(
  ["type-reference", "extends", "component-type"],
);

/**
 * Compute the completion candidates for the cursor at `offset` in `tree`, scoped
 * to `owningClass`. Routes by the cursor context to the right OMC source(s) and
 * returns a de-duped, capped list of plain-data candidates (empty when the
 * context offers nothing). No `vscode` import — unit-tested directly against a
 * mocked {@link CompletionClient}.
 *
 * @param tree - parsed buffer (from `ParseCache.parse`).
 * @param offset - UTF-16 code-unit offset (i.e. `document.offsetAt(position)`).
 * @param owningClass - fully-qualified name of the class the document defines.
 * @param client - structural OMC surface; a real `OmcClient` satisfies it.
 */
export async function computeCompletions(
  tree: Tree,
  offset: number,
  owningClass: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const target = targetAt(tree, offset);

  // Member-access head: either the segment-before-the-cursor in an explicit
  // `member-access` target, or — when `targetAt` is null — the token left of a
  // bare `.` trigger (`r.|`, `a.b.|`) recovered by `headBeforeDot`.
  const head =
    target?.context === "member-access"
      ? target.pathToCursor.slice(0, -1)
      : !target
        ? headBeforeDot(tree, offset)
        : null;
  if (head) return cap(await memberCandidates(owningClass, head, client));

  if (!target) return [];

  if (TYPE_CONTEXTS.has(target.context)) {
    return cap(await classNameCandidates(owningClass, target, client));
  }

  if (target.context === "modifier-name") {
    const typeName = modifiedTypeName(tree, offset);
    if (!typeName) return [];
    return cap(await modifierCandidates(owningClass, typeName, client));
  }

  // `component-reference`, `unknown`: a plain value reference or non-completable
  // position. Offering loaded class names here would be noise, so stay silent.
  return [];
}

/**
 * Class/type position: the owning class's *own* nested classes
 * (`getClassNames`) merged with a fuzzy global match (`searchClassNames`) on the
 * prefix the user is typing — local children plus a global fuzzy net, not the
 * full import/extends-aware visible set.
 */
async function classNameCandidates(
  owningClass: string,
  target: CursorTarget,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const out: CompletionCandidate[] = [];

  // Children of the enclosing scope (the owning class). Bare local names.
  try {
    const { classNames } = await client.getClassNames({
      typeName: owningClass,
    });
    for (const name of classNames) {
      out.push({ label: name, kind: CompletionCandidateKind.Class });
    }
  } catch (err) {
    log.debug("language", "completion getClassNames failed", err);
  }

  // Fuzzy global match on the typed prefix (the last segment under the cursor).
  // searchClassNames returns fully-qualified names. It is a global fuzzy search
  // over every loaded class, so only issue it once the prefix is long enough
  // (`MIN_FUZZY_PREFIX`) to bound the cost a short prefix can't (see the const's
  // note); below the threshold the scoped `getClassNames` above still applies.
  const prefix = target.identifier;
  if (prefix.length >= MIN_FUZZY_PREFIX) {
    try {
      const { classNames } = await client.searchClassNames({
        searchText: prefix,
      });
      for (const name of classNames) {
        // The label is a fully-qualified dotted name (`Modelica.Electrical.R`);
        // VSCode filters by the typed word, which stops at the dot, so a bare
        // prefix like `Re` would never match the long label. Filter (and insert)
        // by the last segment so dotted candidates survive word-based filtering
        // and insert the simple name. `getClassNames` candidates above are bare
        // simple names already, so their default range/filter is correct.
        const lastSegment = name.slice(name.lastIndexOf(".") + 1);
        out.push({
          label: name,
          kind: CompletionCandidateKind.Class,
          filterText: lastSegment,
          insertText: lastSegment,
        });
      }
    } catch (err) {
      log.debug("language", "completion searchClassNames failed", err);
    }
  }

  return out;
}

/**
 * Member access after `.`: resolve the head path's type with the resolution
 * layer's shared component-type walk, then offer that type's components. If the
 * head resolves to a PACKAGE rather than a component type, offer its nested
 * class names instead (`Modelica.Electrical.|` → the package's children).
 *
 * The head can be a component path (`r` → its type's members) or a dotted
 * package/class name. We try the component-type walk first; if it yields no
 * type, we treat the head as a qualified class name and probe whether it is a
 * package.
 */
async function memberCandidates(
  owningClass: string,
  head: readonly string[],
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  if (head.length === 0) return [];

  // 1) Component path: walk the head segments to a component type, then list its
  //    members. Reuses `walkCrefType` — the SAME walk `resolve.ts` uses.
  const componentType = await walkCrefType(owningClass, head, client);
  if (componentType) {
    return memberComponents(componentType, client);
  }

  // 2) Package / class path: qualify the dotted head in scope and, if it names a
  //    package, offer its nested classes.
  const qualified = await qualifyTypeReference(owningClass, head, client);
  if (qualified) {
    const candidates = await packageClassCandidates(qualified, client);
    if (candidates.length > 0) return candidates;
  }

  return [];
}

/**
 * Run an OMC call that may throw, log + swallow on failure, and return a
 * fallback. Used by the candidate-source helpers below so each throwing call
 * site reads as one line and the "swallow + log + fallback" pattern lives in
 * one place.
 */
async function tryCall<T>(
  label: string,
  call: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    // `log.debug` (not `warn`) — completion fires on every keystroke, so a
    // persistent OMC failure must not flood the OutputChannel.
    log.debug("language", `completion ${label} failed`, err);
    return fallback;
  }
}

/** Components declared on `typeName`, as Field candidates with their type. */
async function memberComponents(
  typeName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const { components } = await tryCall(
    "getComponents",
    () => client.getComponents({ typeName }),
    { components: [] },
  );
  return components.map((c) => {
    const candidate: CompletionCandidate = {
      label: c.name,
      kind: CompletionCandidateKind.Field,
    };
    // Only attach `detail` when there's a type to show; `exactOptionalPropertyTypes`
    // forbids assigning `undefined` to the optional field.
    return c.className.length > 0
      ? { ...candidate, detail: c.className }
      : candidate;
  });
}

/**
 * Nested class names of `qualifiedName` when it is a package, as Class
 * candidates. Returns empty when `qualifiedName` is not a package (so the caller
 * doesn't mistake a non-package's empty list for "package with no children").
 */
async function packageClassCandidates(
  qualifiedName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const { b: isPkg } = await tryCall(
    "isPackage",
    () => client.isPackage({ typeName: qualifiedName }),
    { b: false },
  );
  if (!isPkg) return [];

  const { classNames } = await tryCall(
    "package getClassNames",
    () => client.getClassNames({ typeName: qualifiedName }),
    { classNames: [] },
  );
  return classNames.map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Class,
  }));
}

/**
 * Modifier name: the parameter names of the class being modified. The class is
 * the declaration's *type* — `cursor.ts`'s `modifiedTypeName` reads it straight
 * from the enclosing `component_clause`/`extends_clause`, since the modifier
 * name's own dotted path does NOT contain the type it modifies. The (possibly
 * short, possibly dotted) type name is qualified in the owning class's scope,
 * then its parameters are listed.
 */
async function modifierCandidates(
  owningClass: string,
  typeName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  // Qualify the declared type in scope so `getParameterNames` gets the
  // fully-qualified class (a short `Resistor` won't resolve on its own).
  const qualified =
    (await qualifyTypeReference(owningClass, [typeName], client)) ?? typeName;

  const { parameters } = await tryCall(
    "getParameterNames",
    () => client.getParameterNames({ typeName: qualified }),
    { parameters: [] },
  );
  return parameters.map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Property,
  }));
}

/**
 * De-dupe by label (first kind wins) and cap the list. The first occurrence
 * wins so local children rank ahead of fuzzy global hits with the same name.
 */
function cap(candidates: CompletionCandidate[]): CompletionCandidate[] {
  const seen = new Set<string>();
  const out: CompletionCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    out.push(c);
    if (out.length >= MAX_COMPLETIONS) break;
  }
  return out;
}

/** Map the local kind enum to VSCode's. Lives in the thin (impure) layer. */
export function toVscodeCompletionKind(
  kind: CompletionCandidateKind,
): vscode.CompletionItemKind {
  switch (kind) {
    case CompletionCandidateKind.Class:
      return vscode.CompletionItemKind.Class;
    case CompletionCandidateKind.Field:
      return vscode.CompletionItemKind.Field;
    case CompletionCandidateKind.Property:
      return vscode.CompletionItemKind.Property;
  }
}

/**
 * The `vscode.CompletionItemProvider` registered for Modelica buffers. Thin
 * wrapper over {@link computeCompletions}: parse, derive the owning class,
 * ensure OMC has the file loaded, compute candidates, then map them to
 * `vscode.CompletionItem`s. Never throws out — degrades to no completions — and
 * honours the cancellation token.
 */
export class ModelicaCompletionProvider
  implements vscode.CompletionItemProvider
{
  constructor(
    private readonly cache: ParseCache,
    private readonly ensureClient: () => Promise<
      CompletionClient & OwningClassClient
    >,
    private readonly sync: OmcSync,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    try {
      const client = await this.ensureClient();
      // Real files load on touch; a virtual `modelica-source:` class is already
      // loaded (see `document-scope.ts`).
      const owning = await resolveDocumentOwner(document, client, this.sync);
      if (!owning) return undefined;

      // Bail between the load and resolve round-trips so a cursor that has
      // already moved on doesn't issue further OMC calls.
      if (token.isCancellationRequested) return undefined;

      const tree = await this.cache.parse(document);
      const candidates = await computeCompletions(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client,
      );
      if (token.isCancellationRequested) return undefined;
      if (candidates.length === 0) return undefined;

      return candidates.map((c) => {
        const item = new vscode.CompletionItem(
          c.label,
          toVscodeCompletionKind(c.kind),
        );
        if (c.detail !== undefined) item.detail = c.detail;
        // Dotted class names need an explicit filter/insert so VSCode's
        // word-based filtering matches the bare typed prefix and accepting the
        // item inserts the simple name rather than the FQN.
        if (c.filterText !== undefined) item.filterText = c.filterText;
        if (c.insertText !== undefined) item.insertText = c.insertText;
        return item;
      });
    } catch (err) {
      // A provider must never throw out — degrade to "no completions".
      log.error("language", "completion provider failed", err);
      return undefined;
    }
  }
}
