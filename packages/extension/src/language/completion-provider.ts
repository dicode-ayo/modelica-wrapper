/**
 * Context-aware autocomplete for Modelica buffers. Parse the buffer, classify
 * the cursor, scope to the document's owning class; the cursor's *context* then
 * selects which OMC query produces the candidate list:
 *
 *   context → candidate source
 *   ─────────────────────────────────────────────────────────────────────────
 *   type-reference / extends / component-type
 *                          → class names: `getClassNames` of the owning class's
 *                            children AND of each enclosing package (the parent
 *                            scope chain) PLUS a fuzzy global `searchClassNames`
 *                            on the typed prefix, MERGED with the built-in types.
 *                            An element/statement start (type-reference /
 *                            component-type, not `extends`) also gets the
 *                            keyword and snippet channels (see
 *                            `static-candidates.ts`).
 *   member-access (after `.`)
 *                          → resolve the head's type via the resolution layer's
 *                            component-type walk (`walkCrefType`), then the
 *                            inheritance-inclusive component list of that type
 *                            (own + `extends`-pulled members) for members. If
 *                            the head is a package, `getClassNames` of it for
 *                            nested classes.
 *   inside `annotation(...)`
 *                          → the spec-defined annotation field names for the
 *                            nested record path (`annotation-schema.ts`), STATIC
 *                            (no OMC). An unknown record offers nothing. Wins
 *                            over the modifier/type branches on the same parens.
 *   inside `(...)` modifier parens
 *                          → the modified type's parameters, INCLUDING inherited
 *                            ones (own + `extends`-pulled, transitively). Fires
 *                            on a partial name, empty parens, and a still
 *                            name-less declaration (`Resistor(|)`).
 *   otherwise              → nothing (don't spam plain value references).
 *
 * The routing + OMC queries live in {@link computeCompletions}, a pure function
 * with no `vscode` import (unit-tested against a mocked client);
 * {@link ModelicaCompletionProvider} is the host wrapper. Only typed
 * `@dicode/omc-client` wrappers are used — never raw `client.call`.
 *
 * Scope: candidates cover the owning class's own children and those of each
 * enclosing package, plus a global fuzzy net. Imported names are NOT enumerated:
 * `qualifyPath` resolves a *typed* name but offers no way to list what an
 * `import` clause brings into scope. Member access and modifier-parameter lists
 * are both inheritance-inclusive (the union over `extends` bases). Completion
 * reflects the last *saved* buffer, so a just-typed unsaved member may be
 * missing.
 */

import * as vscode from "vscode";

import type { Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import {
  annotationFields,
  annotationFieldValues,
} from "./annotation-schema.js";
import {
  annotationPath,
  annotationValueField,
  cursorInErrorRegion,
  headBeforeDot,
  modifiedTypeWithPath,
  targetAt,
  textualWordBefore,
  type CursorContextKind,
  type ModifiedType,
} from "./cursor.js";
import { resolveDocumentOwner } from "./document-scope.js";
import type { ParseCache } from "./parse.js";
import type { OwningClassClient } from "./owning-class.js";
import {
  inheritedComponents,
  inheritedParameterNames,
  qualifyTypeReference,
  walkCrefType,
  type ResolveClient,
} from "./resolve.js";
import {
  builtInTypeCandidates,
  keywordCandidates,
  snippetCandidates,
} from "./static-candidates.js";
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
  /** A Modelica reserved word. */
  Keyword = "keyword",
  /** A code-template snippet whose `insertText` carries placeholder syntax. */
  Snippet = "snippet",
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
   * When {@link isSnippet} is set, this carries `SnippetString` placeholder
   * syntax.
   */
  readonly insertText?: string;
  /**
   * When set, {@link insertText} is a `SnippetString` template (placeholders
   * like `${1:name}`, `$0`) the provider must wrap so VSCode expands it rather
   * than inserting the syntax verbatim.
   */
  readonly isSnippet?: boolean;
}

/**
 * Outcome of {@link computeCompletions}: the candidate list plus whether it is
 * incomplete. `isIncomplete` is true only when a contribution depends on the
 * typed prefix and a longer prefix would yield a different set — the fuzzy
 * global `searchClassNames` net. The provider maps this onto
 * `vscode.CompletionList.isIncomplete`: false lets VSCode filter the returned
 * set locally as the user types (no re-query); true makes it re-invoke the
 * provider as the prefix grows.
 */
export interface CompletionResult {
  readonly candidates: CompletionCandidate[];
  readonly isIncomplete: boolean;
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

/** Context kinds that complete to class/type names (and built-in types). */
const TYPE_CONTEXTS: ReadonlySet<CursorContextKind> =
  new Set<CursorContextKind>(["type-reference", "extends", "component-type"]);

/**
 * Context kinds that begin an element/statement, where keyword and snippet
 * channels apply: every type context except `extends`, whose word is a
 * base-class reference rather than a statement start. Derived from
 * {@link TYPE_CONTEXTS} so a context added there is not silently skipped here.
 */
const ELEMENT_CONTEXTS: ReadonlySet<CursorContextKind> =
  new Set<CursorContextKind>([...TYPE_CONTEXTS].filter((c) => c !== "extends"));

/**
 * Compute the completion result for the cursor at `offset` in `tree`, scoped to
 * `owningClass`. Routes by the cursor context to the right OMC source(s) and
 * returns a de-duped, capped list of plain-data candidates (empty when the
 * context offers nothing) plus an {@link CompletionResult.isIncomplete} flag.
 * No `vscode` import — unit-tested directly against a mocked
 * {@link CompletionClient}.
 *
 * Every context but the fuzzy global type/class-name net is STABLE: its result
 * is a complete set VSCode can filter locally as the prefix grows. Only the
 * `searchClassNames` contribution is prefix-dependent, so a type/class-name
 * position that fires it is marked incomplete to make VSCode re-invoke.
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
): Promise<CompletionResult> {
  // Inside an annotation field's VALUE (`fillPattern = │`): the field's
  // spec-defined enum members, static. Checked before the field-name branch,
  // which also fires inside an annotation `(...)` but at the name slot — a value
  // position is a strict subset that must win first.
  const valueField = annotationValueField(tree, offset);
  if (valueField !== null) {
    return stable(annotationValueCandidates(valueField));
  }

  // Inside an `annotation(...)`: the vocabulary is spec-defined and static, so
  // the nested record-name path selects the valid child fields with no OMC call.
  // Detected structurally (annotation-rooted), it must win before the modifier
  // and type branches, which would otherwise misfire on the same `(...)` nesting.
  const annotation = annotationPath(tree, offset);
  if (annotation !== null) {
    return stable(annotationCandidates(annotation));
  }

  const target = targetAt(tree, offset);

  // Caret on a member segment (`r.v|`): the head is everything before it.
  if (target?.context === "member-access") {
    const head = target.pathToCursor.slice(0, -1);
    if (head.length > 0)
      return stable(cap(await memberCandidates(owningClass, head, client)));
  }

  // Inside a declaration's `(...)` class-modification — partial name (`r(R|)`),
  // empty parens (`r(|)`), or a still-name-less declaration (`Resistor(|)`).
  // Detected structurally, so it fires before the type-name and error-region
  // fallbacks below would mistake a name-less `Resistor(|)` (an `ERROR` parse)
  // for a type reference. A caret on a modifier VALUE is a `component-reference`
  // target, not a `modifier-name`/empty one, so it is excluded here.
  if (target === null || target.context === "modifier-name") {
    const modified = modifiedTypeWithPath(tree, offset);
    if (modified !== null) {
      return stable(
        cap(await modifierCandidates(owningClass, modified, client)),
      );
    }
  }

  // A trailing dot (`r.|`, `Modelica.Blocks.Continuous.|`) is navigation into
  // the path's last segment — a component's members or a package's classes.
  // The parser reads the segment before the dot as a type reference in a type
  // slot, so `targetAt` returns either nothing or a type-context target here;
  // `headBeforeDot` recovers the dotted head and drilling works in type
  // positions (dotted library paths) as much as in expressions.
  if (!target || TYPE_CONTEXTS.has(target.context)) {
    const head = headBeforeDot(tree, offset);
    if (head && head.length > 0)
      return stable(cap(await memberCandidates(owningClass, head, client)));
  }

  if (target && TYPE_CONTEXTS.has(target.context)) {
    return typePositionCandidates(
      owningClass,
      target.identifier,
      ELEMENT_CONTEXTS.has(target.context),
      client,
    );
  }

  // A broken parse loses the statement-position signal, so the keyword/snippet
  // channels stay out; only inside an error region do we fall back to the
  // textual word before the caret (dotted head → member access, bare prefix →
  // type/class-name completion).
  if (!cursorInErrorRegion(tree, offset)) return stable([]);

  const word = textualWordBefore(tree.rootNode.text, offset);
  if (!word) return stable([]);
  if (word.head.length > 0) {
    return stable(cap(await memberCandidates(owningClass, word.head, client)));
  }
  return typePositionCandidates(owningClass, word.prefix, false, client);
}

/** Wrap a stable (locally-filterable) candidate list as a complete result. */
function stable(candidates: CompletionCandidate[]): CompletionResult {
  return { candidates, isIncomplete: false };
}

/**
 * Annotation-position result: the static schema's field names for the record at
 * `path` (empty for an unknown record), as Field candidates. The set is fixed
 * (no prefix-dependent OMC net), so the caller wraps it with {@link stable}.
 */
function annotationCandidates(path: readonly string[]): CompletionCandidate[] {
  return annotationFields(path).map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Field,
  }));
}

/**
 * Annotation value-position result: the field's static enum members
 * (`FillPattern.Solid`, …) or boolean literals as candidates, empty for a field
 * with no value vocabulary. A dotted enum label carries a `filterText` of its
 * member segment — VSCode's default word-based filter stops at the dot, so a
 * bare `So` would never match `FillPattern.Solid` otherwise. The full dotted
 * label is the inserted text (a bare member would be an unresolvable reference).
 * The set is fixed, so the caller wraps it with {@link stable}.
 */
function annotationValueCandidates(field: string): CompletionCandidate[] {
  return annotationFieldValues(field).map((value) => {
    const dot = value.lastIndexOf(".");
    if (dot === -1) {
      return { label: value, kind: CompletionCandidateKind.Keyword };
    }
    return {
      label: value,
      kind: CompletionCandidateKind.Property,
      filterText: value.slice(dot + 1),
    };
  });
}

/**
 * Type/class-name position result: the OMC class names for `prefix` merged with
 * the static built-in types, and — when `withStatementChannels` — the keyword
 * and snippet channels. `cap` bounds only the unbounded OMC names; the fixed
 * static set is merged after. A built-in type whose label already came from the
 * OMC names is dropped so the label appears once; keyword and snippet channels
 * may share a label (e.g. `model`) and are both kept.
 *
 * Incomplete only when the fuzzy global net fired (see {@link CompletionResult}).
 */
async function typePositionCandidates(
  owningClass: string,
  prefix: string,
  withStatementChannels: boolean,
  client: CompletionClient,
): Promise<CompletionResult> {
  const names = await classNameCandidates(owningClass, prefix, client);
  const omcNames = cap(names.candidates);
  const omcLabels = new Set(omcNames.map((c) => c.label));
  const statics = builtInTypeCandidates().filter(
    (c) => !omcLabels.has(c.label),
  );
  if (withStatementChannels) {
    statics.push(...keywordCandidates(), ...snippetCandidates());
  }
  return {
    candidates: [...omcNames, ...statics],
    isIncomplete: names.firedFuzzyNet,
  };
}

/** Class-name candidates plus whether the fuzzy global net was queried. */
interface ClassNameResult {
  readonly candidates: CompletionCandidate[];
  readonly firedFuzzyNet: boolean;
}

/**
 * The owning class followed by each enclosing scope, nearest first, by stripping
 * one trailing dotted segment at a time (`A.B.C` -> `A.B.C`, `A.B`, `A`). The
 * top-level scope (the empty name) is omitted: `getClassNames` with no
 * `typeName` lists every top-level package, which the fuzzy global search
 * already covers.
 */
function enclosingScopes(owningClass: string): string[] {
  const scopes: string[] = [];
  let scope = owningClass;
  while (scope.length > 0) {
    scopes.push(scope);
    const lastDot = scope.lastIndexOf(".");
    if (lastDot === -1) break;
    scope = scope.slice(0, lastDot);
  }
  return scopes;
}

/**
 * Class/type position: nested classes of the owning class and of every enclosing
 * package (the parent scope chain) merged with a fuzzy global match
 * (`searchClassNames`) on the prefix the user is typing. Nearer scopes are pushed
 * first so a name shadowed by an inner scope wins the first-occurrence-wins
 * de-dupe applied at the downstream merge. Reports whether the fuzzy net fired so
 * the caller can mark a prefix-dependent result incomplete.
 *
 * Imported names are absent: `qualifyPath` resolves a typed name but cannot
 * enumerate what an `import` clause brings into scope, so an unqualified import
 * alias won't appear here.
 */
async function classNameCandidates(
  owningClass: string,
  prefix: string,
  client: CompletionClient,
): Promise<ClassNameResult> {
  const out: CompletionCandidate[] = [];

  // The owning class and each enclosing package, nearest first. A bare type
  // reference resolves against this chain, so each level's children are visible
  // local names.
  for (const scope of enclosingScopes(owningClass)) {
    const { classNames } = await tryCall(
      "getClassNames",
      () => client.getClassNames({ typeName: scope }),
      { classNames: [] },
    );
    for (const name of classNames) {
      out.push({ label: name, kind: CompletionCandidateKind.Class });
    }
  }

  // Fuzzy global match on the typed prefix (the last segment under the cursor).
  // searchClassNames returns fully-qualified names. It is a global fuzzy search
  // over every loaded class, so only issue it once the prefix is long enough
  // (`MIN_FUZZY_PREFIX`) to bound the cost a short prefix can't (see the const's
  // note); below the threshold the scoped `getClassNames` above still applies.
  const firedFuzzyNet = prefix.length >= MIN_FUZZY_PREFIX;
  if (firedFuzzyNet) {
    try {
      const { classNames } = await client.searchClassNames({
        searchText: prefix,
      });
      for (const name of classNames) {
        // The label is the fully-qualified name. VSCode filters by the typed
        // word, which stops at the dot, so a bare prefix like `Re` would never
        // match the long label — filter by the last segment. But a global match
        // is not in scope, so insert the FQN: inserting the bare name would
        // leave an unresolvable reference. (`getClassNames` candidates above are
        // in-scope simple names, so their default range/filter is correct.)
        const lastSegment = name.slice(name.lastIndexOf(".") + 1);
        out.push({
          label: name,
          kind: CompletionCandidateKind.Class,
          filterText: lastSegment,
          insertText: name,
        });
      }
    } catch (err) {
      log.debug("language", "completion searchClassNames failed", err);
    }
  }

  return { candidates: out, firedFuzzyNet };
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

/**
 * Members of `typeName`, as Field candidates with their type — the
 * inheritance-inclusive list (own components plus those pulled in through
 * `extends`, transitively), so MSL types whose members are mostly inherited
 * surface them all.
 */
async function memberComponents(
  typeName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const components = await inheritedComponents(typeName, client);
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
 * Class-modification position: the parameters of the class being modified,
 * INCLUDING inherited ones. The declaration's *type* (`modified.type`) is
 * qualified in the owning class's scope, then `modified.path` is walked through
 * the inheritance-inclusive component lists — each segment resolves to a
 * sub-component's type in the previous type — so a nested modifier
 * (`Motor m(resistor(|))`) lists the inner `resistor`'s parameters, not the
 * outer `Motor`'s. An empty path lists the qualified type's parameters directly.
 * A segment that doesn't resolve yields no candidates.
 *
 * `getParameterNames` reports only a class's OWN parameters, so the list is the
 * inheritance-inclusive union over the innermost type's `extends` bases (mirrors
 * the member-access component walk).
 */
async function modifierCandidates(
  owningClass: string,
  modified: ModifiedType,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  // Qualify the declared type in scope so the parameter lookups get the
  // fully-qualified class (a short `Resistor` won't resolve on its own).
  const qualified =
    (await qualifyTypeReference(owningClass, [modified.type], client)) ??
    modified.type;

  const innermost =
    modified.path.length === 0
      ? qualified
      : await walkCrefType(qualified, modified.path, client);
  if (innermost === undefined) return [];

  const parameters = await inheritedParameterNames(innermost, client);
  return parameters.map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Property,
  }));
}

/**
 * De-dupe by label (first occurrence wins, so local children rank ahead of
 * fuzzy global hits of the same name) and bound the list to
 * {@link MAX_COMPLETIONS}.
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
    case CompletionCandidateKind.Keyword:
      return vscode.CompletionItemKind.Keyword;
    case CompletionCandidateKind.Snippet:
      return vscode.CompletionItemKind.Snippet;
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
  ): Promise<vscode.CompletionList | undefined> {
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
      const { candidates, isIncomplete } = await computeCompletions(
        tree,
        document.offsetAt(position),
        owning.qualifiedName,
        client,
      );
      if (token.isCancellationRequested) return undefined;
      if (candidates.length === 0) return undefined;

      const items = candidates.map((c) => {
        const item = new vscode.CompletionItem(
          c.label,
          toVscodeCompletionKind(c.kind),
        );
        if (c.detail !== undefined) item.detail = c.detail;
        // Dotted class names need an explicit filter/insert so VSCode's
        // word-based filtering matches the bare typed prefix and accepting the
        // item inserts the simple name rather than the FQN.
        if (c.filterText !== undefined) item.filterText = c.filterText;
        if (c.insertText !== undefined) {
          // A snippet's insertText carries placeholder syntax; wrap it so
          // VSCode expands the template instead of inserting it verbatim.
          item.insertText = c.isSnippet
            ? new vscode.SnippetString(c.insertText)
            : c.insertText;
        }
        return item;
      });

      // `isIncomplete` true makes VSCode re-invoke as the prefix grows (the
      // fuzzy global net depends on it); false lets it filter this set locally.
      return new vscode.CompletionList(items, isIncomplete);
    } catch (err) {
      // A provider must never throw out — degrade to "no completions".
      log.error("language", "completion provider failed", err);
      return undefined;
    }
  }
}
