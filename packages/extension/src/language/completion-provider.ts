/**
 * Context-aware autocomplete (#99) — the suggestive half of the hybrid loop.
 *
 * Same front-end as go-to-definition / hover: parse the buffer (`ParseCache`),
 * classify the cursor (`cursor.ts`), scope to the document's owning class
 * (`owning-class.ts`). Instead of resolving ONE name, the cursor's *context*
 * selects which OMC query produces the candidate list:
 *
 *   context → candidate source
 *   ─────────────────────────────────────────────────────────────────────────
 *   type-reference / extends / component-type
 *                          → class names: `getClassNames` of the relevant scope
 *                            (children of the owning class) PLUS a fuzzy global
 *                            `searchClassNames` on the typed prefix.
 *   member-access (after `.`)
 *                          → resolve the head's type via the resolution layer's
 *                            component-type walk (`walkCrefType`), then
 *                            `getComponents` of that type for members. If the
 *                            head is a package, `getClassNames` of it for nested
 *                            classes.
 *   modifier-name          → `getParameterNames` of the class being modified.
 *   otherwise              → nothing (don't spam plain value references).
 *
 * ## Pure / impure split (testability)
 *
 * Mirrors `definition-provider.ts` / `hover-provider.ts`: the routing + OMC
 * queries live in {@link computeCompletions}, which takes a tree-sitter `Tree` +
 * offset + owning class + a structural OMC surface and returns **plain data**
 * ({@link CompletionCandidate}[]) with NO `vscode` import, so each context's
 * routing is unit-testable against a mocked client (see
 * `completion-provider.test.ts`). The `vscode.CompletionItemProvider` wrapper
 * ({@link ModelicaCompletionProvider}) is a thin shell that parses, derives the
 * owning class, ensures the file is loaded, calls `computeCompletions`, maps the
 * local {@link CompletionItemKind} to `vscode.CompletionItemKind`, and never
 * throws out (honours the `CancellationToken`).
 *
 * Only typed `@dicode/omc-client` wrappers are used — never raw `client.call`.
 * The member-access head type comes from the resolution layer's shared
 * `walkCrefType`, not a re-implemented walk.
 *
 * ## v1 scoping simplifications (documented inline at the call sites)
 *
 *   - **Class-name scope.** "Relevant scope" for type/extends position is the
 *     owning class's *own* children plus a fuzzy global `searchClassNames`. A
 *     full import/extends-aware visible-name set is a refinement; the seam is
 *     {@link classNameCandidates}.
 *   - **Inherited members.** `getComponents`/`getParameterNames` report only a
 *     class's *own* declared members — inherited ones are the same v1 gap as the
 *     rest of the language layer (see `resolve.ts`).
 *   - **Staleness.** Completion reflects the last *saved* buffer (the coarse v1
 *     sync policy in `sync.ts`), so a just-typed unsaved member may be missing.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";
import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import {
  headBeforeDot,
  modifiedTypeName,
  targetAt,
  type CursorContextKind,
  type CursorTarget,
} from "./cursor.js";
import type { ParseCache } from "./parse.js";
import { resolveOwningClass, type OwningClassClient } from "./owning-class.js";
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
export const MAX_COMPLETIONS = 200;

/**
 * What a candidate *is*, decoupled from `vscode.CompletionItemKind` so the pure
 * core has no `vscode` dependency. {@link toVscodeCompletionKind} maps these to
 * the editor enum in the thin provider.
 */
export enum CompletionItemKind {
  /** A class/type name (model, block, record, …). */
  Class = "class",
  /** A package (namespace) name. */
  Module = "module",
  /** A component / member instance of a class. */
  Field = "field",
  /** A parameter / modifiable name. */
  Property = "property",
}

/** A single completion candidate, as plain data (no `vscode` types). */
export interface CompletionCandidate {
  /** The text inserted / shown. */
  readonly label: string;
  /** What the candidate is, driving the icon shown. */
  readonly kind: CompletionItemKind;
  /** Optional secondary text (e.g. the member's type). */
  readonly detail?: string;
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

  // Bare-dot trigger (`r.|`, `a.b.|`): nothing is typed after the `.` yet, so
  // there is no identifier to land on and `targetAt` is null. Recover the head
  // path from the token left of the dot and complete its members with an empty
  // prefix.
  if (!target) {
    const head = headBeforeDot(tree, offset);
    if (head) return cap(await memberCandidates(owningClass, head, client));
    return [];
  }

  if (target.context === "member-access") {
    // pathToCursor is e.g. ["r", "v"]: the head whose members we offer is every
    // segment BEFORE the one under the cursor; the last segment is the prefix
    // the user is typing (VSCode filters by it, so we don't pre-filter).
    const head = target.pathToCursor.slice(0, -1);
    return cap(await memberCandidates(owningClass, head, client));
  }

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
 * prefix the user is typing. v1 scope simplification: this is NOT the full
 * import/extends-aware visible set — it is the local children plus a global
 * fuzzy net, which covers the common cases (a sibling type, or a fully-qualified
 * library type). Refining to the exact visible-name set is a follow-up; this
 * function is the seam.
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
      out.push({ label: name, kind: CompletionItemKind.Class });
    }
  } catch (err) {
    log.warn("language", "completion getClassNames failed", err);
  }

  // Fuzzy global match on the typed prefix (the last segment under the cursor).
  // searchClassNames returns fully-qualified names; only worth issuing when the
  // user has typed something to search for.
  const prefix = target.identifier;
  if (prefix.length > 0) {
    try {
      const { classNames } = await client.searchClassNames({
        searchText: prefix,
      });
      for (const name of classNames) {
        out.push({ label: name, kind: CompletionItemKind.Class });
      }
    } catch (err) {
      log.warn("language", "completion searchClassNames failed", err);
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

/** Components declared on `typeName`, as Field candidates with their type. */
async function memberComponents(
  typeName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  let components;
  try {
    ({ components } = await client.getComponents({ typeName }));
  } catch (err) {
    log.warn("language", "completion getComponents failed", err);
    return [];
  }
  return components.map((c) => {
    const candidate: CompletionCandidate = {
      label: c.name,
      kind: CompletionItemKind.Field,
    };
    // Only attach `detail` when there's a type to show; `exactOptionalPropertyTypes`
    // forbids assigning `undefined` to the optional field.
    return c.className.length > 0
      ? { ...candidate, detail: c.className }
      : candidate;
  });
}

/**
 * Nested class names of `qualifiedName` when it is a package, as Module/Class
 * candidates. Returns empty when `qualifiedName` is not a package (so the caller
 * doesn't mistake a non-package's empty list for "package with no children").
 */
async function packageClassCandidates(
  qualifiedName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  let isPkg = false;
  try {
    ({ b: isPkg } = await client.isPackage({ typeName: qualifiedName }));
  } catch (err) {
    log.warn("language", "completion isPackage failed", err);
    return [];
  }
  if (!isPkg) return [];

  try {
    const { classNames } = await client.getClassNames({
      typeName: qualifiedName,
    });
    return classNames.map((name) => ({
      label: name,
      kind: CompletionItemKind.Class,
    }));
  } catch (err) {
    log.warn("language", "completion package getClassNames failed", err);
    return [];
  }
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

  let parameters;
  try {
    ({ parameters } = await client.getParameterNames({
      typeName: qualified,
    }));
  } catch (err) {
    log.warn("language", "completion getParameterNames failed", err);
    return [];
  }
  return parameters.map((name) => ({
    label: name,
    kind: CompletionItemKind.Property,
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
  kind: CompletionItemKind,
): vscode.CompletionItemKind {
  switch (kind) {
    case CompletionItemKind.Class:
      return vscode.CompletionItemKind.Class;
    case CompletionItemKind.Module:
      return vscode.CompletionItemKind.Module;
    case CompletionItemKind.Field:
      return vscode.CompletionItemKind.Field;
    case CompletionItemKind.Property:
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
    private readonly ensureClient: () => Promise<OmcClient>,
    private readonly sync: OmcSync,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    try {
      const client = await this.ensureClient();
      const owning = await resolveOwningClass(document.uri.fsPath, {
        client: client as OwningClassClient,
      });
      if (!owning) return undefined;

      // Load-on-touch so OMC's symbol table knows the file's classes.
      await this.sync.ensureLoaded(owning.fileName);

      // The work above (ensureClient + parseFile + loadFile) is serialized; on a
      // fast-moving cursor the host may already have abandoned this request.
      if (token.isCancellationRequested) return undefined;

      const tree = await this.cache.parse(document);
      const candidates = await computeCompletions(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client as CompletionClient,
      );
      if (token.isCancellationRequested) return undefined;
      if (candidates.length === 0) return undefined;

      return candidates.map((c) => {
        const item = new vscode.CompletionItem(
          c.label,
          toVscodeCompletionKind(c.kind),
        );
        if (c.detail !== undefined) item.detail = c.detail;
        return item;
      });
    } catch (err) {
      // A provider must never throw out — degrade to "no completions".
      log.error("language", "completion provider failed", err);
      return undefined;
    }
  }
}
