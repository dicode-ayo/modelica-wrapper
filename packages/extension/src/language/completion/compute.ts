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
 * {@link computeCompletions} is a pure function (unit-tested against a mocked
 * client); the host wrapper lives in the extension's `completion-provider.ts`.
 * Only typed `@dicode/omc-client` wrappers are used — never raw `client.call`.
 *
 * Scope: candidates cover the owning class's own children and those of each
 * enclosing package, plus a global fuzzy net. Imported names are NOT enumerated:
 * `qualifyPath` resolves a *typed* name but offers no way to list what an
 * `import` clause brings into scope. Member access and modifier-parameter lists
 * are both inheritance-inclusive (the union over `extends` bases). Completion
 * reflects the last *saved* buffer, so a just-typed unsaved member may be
 * missing.
 */

import type { Tree } from "web-tree-sitter";

import {
  annotationPath,
  annotationValueField,
  cursorInErrorRegion,
  headBeforeDot,
  modifiedTypeWithPath,
  targetAt,
  textualWordBefore,
  type CursorContextKind,
} from "../cursor.js";

import {
  type CompletionCandidate,
  type CompletionResult,
} from "./candidate.js";
import type { CompletionClient } from "./client.js";
import { cap } from "./merge.js";
import {
  annotationCandidates,
  annotationValueCandidates,
} from "./sources/annotation.js";
import { typePositionCandidates } from "./sources/class-names.js";
import { memberCandidates } from "./sources/members.js";
import { modifierCandidates } from "./sources/modifiers.js";

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
