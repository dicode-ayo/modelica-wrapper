/**
 * Pure, syntactic cursor analysis over a tree-sitter Modelica tree.
 *
 * Nothing here imports `vscode` or talks to OMC — every function takes a
 * `Node`/`Tree` and an offset and returns plain data, so the whole module is
 * unit-testable against fixture trees (see `cursor.test.ts`). The semantic half
 * (resolving a name to a definition) lives in `resolve.ts` in a later PR.
 *
 * ## Offset unit (important)
 *
 * Every `offset` here is a **UTF-16 code-unit offset** — the unit
 * `web-tree-sitter` uses on its JavaScript string-input path
 * (`Node.startIndex` / `descendantForIndex` are UTF-16 offsets when the parser
 * is driven with a JS string; see `position.ts` for the verification). This is
 * the SAME unit VSCode provides, so a provider passes
 * `document.offsetAt(position)` straight through — no byte conversion. The
 * returned `startIndex`/`endIndex` are likewise UTF-16 offsets, ready to build a
 * `vscode.Range` via `document.positionAt(...)`.
 *
 * ## Grammar shapes this relies on (OpenModelica/tree-sitter-modelica v0.2.2)
 *
 * - A dotted *type* name is a left-recursive `name` node:
 *   `name(name(name IDENT . IDENT) . IDENT)`. It appears inside a
 *   `type_specifier`, which is the `typeSpecifier` field of an `extends_clause`
 *   or a `component_clause`, or inside an `import_clause`.
 * - A dotted *value* reference (cref) is a left-recursive `component_reference`
 *   with the same shape, appearing inside expressions.
 * - A modifier name is the `name` field of an `element_modification`.
 *
 * Segments are joined by an anonymous `.` token between `IDENT`s.
 */

import type { Node, Tree } from "web-tree-sitter";

/**
 * What the thing under the cursor *is*, syntactically. Drives which OMC query
 * `resolve.ts` runs and which completion source `completion-provider.ts` uses.
 */
export type CursorContextKind =
  /** A type/class name in a declaration position (component type). */
  | "type-reference"
  /** A type name following `extends`. */
  | "extends"
  /** A class/type name in a component declaration's type slot. */
  | "component-type"
  /** The name of a modifier inside `(...)`, e.g. `R` in `Resistor r(R = 1)`. */
  | "modifier-name"
  /** A member access — a cref segment after a `.` (e.g. `v` in `r.v`). */
  | "member-access"
  /** A value reference / cref head that isn't a member access. */
  | "component-reference"
  /** None of the above — cursor is on whitespace, a keyword, punctuation, … */
  | "unknown";

/** The identifier/cref the cursor is on, plus its classified context. */
export interface CursorTarget {
  /**
   * The single identifier directly under the cursor (one segment), e.g. `v`
   * for `r.v` when the cursor is on `v`.
   */
  readonly identifier: string;
  /**
   * The full dotted path the identifier belongs to, e.g. `["r", "v"]` for the
   * cref `r.v` regardless of which segment the cursor is on. For a bare
   * identifier this is a single-element array.
   */
  readonly path: readonly string[];
  /**
   * The dotted path up to AND INCLUDING the segment under the cursor — the
   * prefix a resolver should qualify. For the cursor on `b` in `a.b.c` this is
   * `["a", "b"]`.
   */
  readonly pathToCursor: readonly string[];
  readonly context: CursorContextKind;
  /** UTF-16 code-unit range of the single identifier under the cursor. */
  readonly startIndex: number;
  readonly endIndex: number;
}

/** The kinds of dotted-path node the grammar produces. */
const NAME_NODE = "name";
const CREF_NODE = "component_reference";
const IDENT_NODE = "IDENT";
const TYPE_SPECIFIER_NODE = "type_specifier";

/**
 * The named node at `offset` (a **UTF-16 code-unit offset** — see the module
 * note). Prefers a *named* descendant (skips anonymous tokens like `.`, `(`,
 * `;`) so callers get a meaningful node. When the offset sits exactly on
 * punctuation, the nearest named node is returned instead.
 */
export function nodeAt(tree: Tree, offset: number): Node | null {
  const named = tree.rootNode.namedDescendantForIndex(offset, offset);
  return named ?? null;
}

/**
 * The `IDENT` token at `offset` (a **UTF-16 code-unit offset** — see the module
 * note), if any. When the offset lands on a `.` between two identifiers we bias
 * to the identifier *before* the dot (the segment the user most likely means
 * when the caret is just past it). The one-unit-left fallback steps a single
 * UTF-16 code unit; on a surrogate-pair boundary tree-sitter still resolves to
 * the enclosing token, so this stays correct for non-ASCII.
 */
export function identifierAt(tree: Tree, offset: number): Node | null {
  let node = tree.rootNode.descendantForIndex(offset, offset);
  if (node && node.type === IDENT_NODE) return node;
  // On a dot or at a boundary: try one code unit to the left.
  if (offset > 0) {
    node = tree.rootNode.descendantForIndex(offset - 1, offset - 1);
    if (node && node.type === IDENT_NODE) return node;
  }
  return null;
}

/**
 * Resolve the cursor at `offset` (a **UTF-16 code-unit offset** — see the
 * module note) to the identifier under it, the dotted path it belongs to, and
 * the syntactic context. Returns `null` when the cursor is not on an identifier
 * (whitespace, keyword, punctuation). The returned `startIndex`/`endIndex` are
 * likewise UTF-16 offsets (tree-sitter's `Node.startIndex`/`endIndex` on the
 * string-input path), ready for `document.positionAt(...)`.
 */
export function targetAt(tree: Tree, offset: number): CursorTarget | null {
  const ident = identifierAt(tree, offset);
  if (!ident) return null;

  const dotted = enclosingDottedNode(ident);
  const path = dotted ? segmentsOf(dotted) : [ident.text];
  const pathToCursor = dotted ? segmentsUpTo(dotted, ident) : [ident.text];

  return {
    identifier: ident.text,
    path,
    pathToCursor,
    context: classify(ident, dotted),
    startIndex: ident.startIndex,
    endIndex: ident.endIndex,
  };
}

/**
 * The dotted path immediately *before* a `.` at `offset` — the "head" whose
 * members an after-dot completion should offer.
 *
 * `targetAt` only classifies a `member-access` once at least one character has
 * been typed after the dot (there is an `IDENT` to land on). The other case —
 * the user has just typed the trigger `.` with nothing after it (`r.|`, `a.b.|`)
 * — parses as an `ERROR` node with no identifier under the cursor, so
 * `targetAt` returns `null`. This helper recovers the head for exactly that
 * case: it looks at the identifier directly to the LEFT of `offset` and, if the
 * character at `offset - 1` is a `.`, returns the dotted segments of the
 * enclosing `name`/`component_reference` (e.g. `["a", "b"]` for `a.b.|`).
 *
 * Returns `null` when `offset` is not immediately after a dot or there is no
 * dotted head to the left. The prefix being completed is empty in this case.
 *
 * @see Offset unit — module note.
 */
export function headBeforeDot(tree: Tree, offset: number): string[] | null {
  if (offset <= 0) return null;
  // The trigger fires with the caret just past the `.`; the char at offset-1
  // must be that dot for this to be an after-dot completion.
  const dot = tree.rootNode.descendantForIndex(offset - 1, offset - 1);
  if (!dot || dot.type !== ".") return null;
  // The identifier left of the dot is the last segment of the head path.
  const ident = identifierAt(tree, dot.startIndex);
  if (!ident) return null;
  const dotted = enclosingDottedNode(ident);
  // A bare `r.` has no enclosing dotted node yet (the cref is just `r`); the
  // single identifier is itself the whole head. Take segments up to the
  // identifier left of the dot: when the cref is immediately followed by a
  // keyword (`Modelica.Blocks.Continuous.\nend M;`) the parser absorbs that
  // token as a trailing segment, which `segmentsUpTo` excludes.
  return dotted ? segmentsUpTo(dotted, ident) : [ident.text];
}

/**
 * Does the cursor at `offset` sit inside a parse-error region — i.e. is the
 * node under it, or one of its ancestors, an `ERROR` node or `isMissing`? A
 * clean parse never trips this; a mid-edit, unparseable buffer does.
 *
 * @see Offset unit — module note.
 */
export function cursorInErrorRegion(tree: Tree, offset: number): boolean {
  if (hasErrorAncestor(tree.rootNode.descendantForIndex(offset, offset))) {
    return true;
  }
  // At the very end of the buffer (or on a boundary) `descendantForIndex`
  // resolves to the outermost node spanning the point, hiding a deeper error
  // leaf; probe one code unit left, mirroring `identifierAt`.
  if (offset > 0) {
    return hasErrorAncestor(
      tree.rootNode.descendantForIndex(offset - 1, offset - 1),
    );
  }
  return false;
}

function hasErrorAncestor(node: Node | null): boolean {
  let n = node;
  while (n) {
    if (n.type === "ERROR" || n.isMissing) return true;
    n = n.parent;
  }
  return false;
}

/**
 * A purely textual word-before-caret, split on the last dot — the routing
 * fallback for buffers too broken for {@link targetAt}/{@link headBeforeDot} to
 * yield an AST context. `head` is the dotted segments left of the last dot
 * (empty when the word has no dot), and `prefix` is the partial segment right of
 * it (the characters the user is typing).
 *
 *   `r.`    → { head: ["r"],      prefix: "" }
 *   `r.va`  → { head: ["r"],      prefix: "va" }
 *   `a.b.c` → { head: ["a", "b"], prefix: "c" }
 *   `Res`   → { head: [],         prefix: "Res" }
 */
export interface TextualWord {
  readonly head: readonly string[];
  readonly prefix: string;
}

/**
 * Extract the {@link TextualWord} ending at `offset` from `source` (the raw
 * buffer text). The word is the maximal run of Modelica identifier characters
 * and dots immediately left of `offset`. Returns `null` when no such run exists
 * (the caret sits after whitespace, an operator, or the buffer start) or when a
 * head segment is empty (e.g. a leading `.` or a `..`), since neither routes to
 * a meaningful completion.
 *
 * @see Offset unit — module note.
 */
export function textualWordBefore(
  source: string,
  offset: number,
): TextualWord | null {
  let start = offset;
  while (start > 0 && isWordChar(source.charCodeAt(start - 1))) start--;
  const word = source.slice(start, offset);
  if (word.length === 0) return null;

  const lastDot = word.lastIndexOf(".");
  if (lastDot === -1) return { head: [], prefix: word };

  const prefix = word.slice(lastDot + 1);
  const head = word.slice(0, lastDot).split(".");
  // A `..`, leading `.`, or trailing `.` in the head yields an empty segment
  // that resolves to nothing; bail rather than walk a bogus path.
  if (head.some((seg) => seg.length === 0)) return null;
  return { head, prefix };
}

/**
 * Modelica identifier characters plus `.` (the dotted-path separator). ASCII
 * letters, digits, and `_`; the leading-digit constraint is irrelevant here
 * since this only segments an existing run, never validates an identifier.
 */
function isWordChar(code: number): boolean {
  return (
    code === 0x2e || // .
    code === 0x5f || // _
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) // a-z
  );
}

/**
 * The declaration type whose `(...)` class-modification the cursor at `offset`
 * is inside, plus the chain of nested modifier-component names from that
 * declaration down to the caret's modification.
 *
 * `type` is the *outer* declaration's type — `component_clause`'s
 * `typeSpecifier` or `extends_clause`'s type. `path` is empty when the caret is
 * directly in the declaration's own modifier list, and one segment per enclosing
 * `element_modification` for a nested one:
 *
 *   `Resistor r(R = |)`    → { type: "Resistor", path: [] }
 *   `Motor m(resistor(|))` → { type: "Motor",    path: ["resistor"] }
 *   `Motor m(a(b(|)))`     → { type: "Motor",    path: ["a", "b"] }
 *
 * The type is read from the declaration rather than from any modifier name
 * because a modifier name's own dotted path does NOT contain the type it
 * modifies; a caller resolves each `path` segment against the previous type.
 *
 * See {@link modifiedTypeName} for the full contract on structural detection,
 * empty parens, the name-less `ERROR` recovery (which yields an empty `path`),
 * and the value-position non-distinction.
 */
export interface ModifiedType {
  readonly type: string;
  readonly path: readonly string[];
}

export function modifiedTypeWithPath(
  tree: Tree,
  offset: number,
): ModifiedType | null {
  // Deepest node spanning the caret, including anonymous tokens (`(`, `)`),
  // since an empty modifier list has no identifier to land on.
  let node: Node | null = tree.rootNode.descendantForIndex(offset, offset);
  while (node) {
    if (node.type === "class_modification") {
      if (!insideParens(node, offset)) return null;
      const type = declaringTypeOfModification(node);
      return type === null ? null : { type, path: nestedModifierPath(node) };
    }
    // A declaration with no component name (`Resistor(|)`) doesn't parse as a
    // `component_clause`; the parser recovers it as an `ERROR` holding the
    // `type_specifier` followed by the `(…)` the caret is inside.
    if (node.type === "ERROR") {
      const recovered = declaringTypeFromErrorParens(node, offset);
      if (recovered !== null) return { type: recovered, path: [] };
    }
    node = node.parent;
  }
  return null;
}

/**
 * The dotted *type name* of the declaration whose `(...)` class-modification the
 * cursor at `offset` is inside — the class whose parameters a TOP-LEVEL modifier
 * completion should offer. For `Resistor r(R = |)` this is `"Resistor"`; for an
 * empty `Resistor r(|)` it is still `"Resistor"`; for `extends Base(p = |)` it
 * is `"Base"`; for a dotted type `Modelica.Electrical.Resistor r(R = |)` it is
 * the full dotted text. Also covers the mid-edit case where no component name
 * has been typed yet (`Resistor(|)`, `Modelica…Resistor(|)`), which the parser
 * recovers as an `ERROR` region rather than a `component_clause`.
 *
 * Detection is STRUCTURAL — the caret is inside a `class_modification`'s parens
 * (or an `ERROR` recovery of `type_specifier (…)`), not keyed to an
 * `element_modification` name. So an empty modifier list resolves a type even
 * with no modifier name under the caret. This does NOT distinguish a name slot
 * from a value slot — `Resistor r(R = x|)` still returns `"Resistor"`; a caller
 * that must exclude the modifier-value position gates on the cursor context
 * itself. Returns `null` when the caret is not inside such a modifier list, or
 * the declaring type is empty/unresolvable.
 *
 * This reports only the outer declaration's type; for a nested modifier
 * (`Motor m(resistor(|))`) it returns `"Motor"`. {@link modifiedTypeWithPath}
 * additionally reports the `["resistor"]` chain a nested completion walks.
 *
 * @see Offset unit — module note.
 */
export function modifiedTypeName(tree: Tree, offset: number): string | null {
  return modifiedTypeWithPath(tree, offset)?.type ?? null;
}

/**
 * The modifier-component names from the outer declaration down to (but not
 * including) the caret's `class_modification`. Empty when `modification` is the
 * declaration's own modifier list. Each enclosing `element_modification` wraps
 * its inner `class_modification` in a `modification`, so the walk collects one
 * name per level until it reaches the declaration
 * (`component_clause`/`extends_clause`).
 */
function nestedModifierPath(modification: Node): string[] {
  const path: string[] = [];
  let n: Node | null = modification.parent;
  while (n) {
    if (n.type === "component_clause" || n.type === "extends_clause") break;
    collectModifierName(n, path);
    n = n.parent;
  }
  return path;
}

/**
 * If `node` is an `element_modification`, prepend its modifier-component name to
 * `path`. Only the `name` field is a modifier-component name; a `firstNameChild`
 * fallback could grab a `type_specifier` and unshift a non-component segment
 * that would mis-resolve in the walk.
 */
function collectModifierName(node: Node, path: string[]): void {
  if (node.type !== "element_modification") return;
  const name = node.childForFieldName("name");
  if (name && name.text.length > 0) path.unshift(name.text);
}

/**
 * The annotation record-name chain from the enclosing `annotation_clause` down
 * to the caret at `offset`, or `null` when the caret is NOT inside an
 * annotation. `[]` directly inside `annotation(│)`; one segment per enclosing
 * record (`annotation(Placement(transformation(│)))` → `["Placement",
 * "transformation"]`).
 *
 * An annotation parses as an `annotation_clause` whose `class_modification`
 * nests records exactly like a component modifier — `element_modification`
 * (record name) → `modification` → `class_modification`. The distinguishing
 * feature is the ROOT: the outermost `class_modification` enclosing the caret is
 * a direct child of an `annotation_clause`, not of a `component_clause`/
 * `extends_clause`. A component modifier (`r(R(│))`) therefore returns `null`
 * here, and an annotation returns `null` from {@link modifiedTypeWithPath}
 * (whose walk stops at the declaration that an annotation lacks).
 *
 * @see Offset unit — module note.
 */
export function annotationPath(
  tree: Tree,
  offset: number,
): readonly string[] | null {
  let node: Node | null = tree.rootNode.descendantForIndex(offset, offset);
  while (node) {
    if (node.type === "class_modification") {
      if (!insideParens(node, offset)) return null;
      return annotationRootedPath(node);
    }
    node = node.parent;
  }
  return null;
}

/**
 * The record-name chain for the caret's `class_modification`, or `null` when the
 * walk up does not terminate at an `annotation_clause`. Mirrors
 * {@link nestedModifierPath} but is annotation-rooted: it collects one name per
 * enclosing `element_modification` and returns a path only once it confirms the
 * outermost enclosing `class_modification` belongs to an annotation.
 */
function annotationRootedPath(modification: Node): readonly string[] | null {
  const path: string[] = [];
  let n: Node | null = modification.parent;
  while (n) {
    if (n.type === "annotation_clause") return path;
    if (n.type === "component_clause" || n.type === "extends_clause") {
      return null;
    }
    collectModifierName(n, path);
    n = n.parent;
  }
  return null;
}

/**
 * The annotation field whose VALUE the caret at `offset` is assigning, or `null`
 * when the caret is not in an annotation value position. The caret must be inside
 * an annotation (gated on {@link annotationPath}) and to the right of a field's
 * `=`, e.g. `fillPattern` for any of:
 *
 *   `fillPattern = │`             (empty value)
 *   `fillPattern = FillPattern.│` (after the enum dot)
 *   `fillPattern = FillPattern.Solid│`
 *   `smooth = {Smooth.│}`         (braced array element)
 *
 * Distinguished from the field-NAME position ({@link annotationPath}, the
 * field-name completion source): a caret ON the `name` IDENT of an
 * `element_modification` — or in empty record parens with no `=` before it —
 * returns `null` here so field-name completion is untouched. A completed
 * `field = value,` followed by the caret (a fresh field-name slot) also returns
 * `null`.
 *
 * Two parse shapes carry the value. A value the parser could attach sits in the
 * field's `element_modification` as a `= expr` `modification` (the caret is
 * within it). A value it could NOT attach — empty (`= │`) or trailing-dot
 * (`= Enum.│`) — leaves the field's `element_modification` holding only its name
 * and strands the `=`/`.` as `ERROR` siblings in the enclosing
 * `class_modification`; the field name is then the nearest one before the caret
 * with a stray token and no intervening `,`.
 *
 * @see Offset unit — module note.
 */
export function annotationValueField(
  tree: Tree,
  offset: number,
): string | null {
  if (annotationPath(tree, offset) === null) return null;

  const attached = attachedValueField(tree, offset);
  if (attached !== null) return attached;
  return strayValueField(tree, offset);
}

/**
 * The field whose attached `= expr` `modification` the caret sits within. A
 * caret on the field's own `name` returns `null` — that is the field-NAME slot,
 * not a value.
 */
function attachedValueField(tree: Tree, offset: number): string | null {
  let node: Node | null = tree.rootNode.descendantForIndex(offset, offset);
  while (node) {
    if (node.type === "element_modification") {
      const name = node.childForFieldName("name");
      if (name && offset >= name.startIndex && offset <= name.endIndex) {
        return null;
      }
      const mod = node.childForFieldName("modification");
      if (
        name &&
        mod &&
        isAssignmentModification(mod) &&
        offset >= mod.startIndex &&
        offset <= mod.endIndex
      ) {
        return name.text;
      }
    }
    node = node.parent;
  }
  return null;
}

/**
 * The field whose value the parser could not attach (empty or trailing-dot),
 * recovered from the enclosing `class_modification`'s flattened children: the
 * nearest field `element_modification` before the caret that is followed by a
 * stray `=`/`.`/`ERROR` token, with no `,` closing the argument in between.
 */
function strayValueField(tree: Tree, offset: number): string | null {
  let node: Node | null = tree.rootNode.descendantForIndex(offset, offset);
  while (node) {
    if (node.type === "class_modification") {
      const field = strayValueFieldIn(node, offset);
      if (field !== null) return field;
    }
    node = node.parent;
  }
  return null;
}

/** A `,` between arguments — sometimes recovered as an `ERROR` holding `,`. */
function isArgumentSeparator(token: Node): boolean {
  return token.type === "," || (token.type === "ERROR" && token.text === ",");
}

function strayValueFieldIn(classMod: Node, offset: number): string | null {
  let field: string | null = null;
  let stray = false;
  for (const token of flattenedModificationTokens(classMod)) {
    if (token.startIndex >= offset) break;
    if (isArgumentSeparator(token)) {
      field = null;
      stray = false;
    } else if (token.type === "element_modification") {
      const name = token.childForFieldName("name");
      field = name && name.text.length > 0 ? name.text : null;
      stray = false;
    } else if (
      field !== null &&
      // The value the parser couldn't attach strands a `=` or a trailing `.`,
      // sometimes wrapped in a single-token `ERROR`.
      (token.type === "=" ||
        token.type === "." ||
        (token.type === "ERROR" && /^[=.]$/.test(token.text)))
    ) {
      stray = true;
    }
  }
  return stray ? field : null;
}

/**
 * The children of a `class_modification` in document order, flattening its
 * `argument_list` one level so the field `element_modification`s and the stray
 * `=`/`.`/`ERROR` tokens an unattachable value leaves behind interleave as the
 * caret sees them. The surrounding `(`/`)` are dropped.
 */
function flattenedModificationTokens(classMod: Node): Node[] {
  const tokens: Node[] = [];
  for (let i = 0; i < classMod.childCount; i++) {
    const child = classMod.child(i);
    if (!child || child.type === "(" || child.type === ")") continue;
    if (child.type === "argument_list") {
      for (let j = 0; j < child.childCount; j++) {
        const grandchild = child.child(j);
        if (grandchild) tokens.push(grandchild);
      }
    } else {
      tokens.push(child);
    }
  }
  return tokens;
}

/** Is `modification` an assignment (`= expr`) rather than a nested `(…)` record? */
function isAssignmentModification(modification: Node): boolean {
  return firstChildOfType(modification, "=") !== null;
}

/** Is `offset` strictly after a node's opening `(` and at/before its `)`? */
function insideParens(node: Node, offset: number): boolean {
  const open = firstChildOfType(node, "(");
  if (!open) return false;
  const close = firstChildOfType(node, ")");
  const upper = close ? close.endIndex : node.endIndex;
  return offset >= open.endIndex && offset <= upper;
}

/** First direct child of `node` with the given type, or null. */
function firstChildOfType(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

/**
 * Walk up from a `class_modification` to the declaration carrying the type
 * being modified — a `component_clause`'s `typeSpecifier` or an
 * `extends_clause`'s type. Returns null when neither encloses it or the type
 * text is empty.
 *
 * This resolves to the nearest enclosing *declaration's* type. A nested
 * modification (`r(sub(|))`) returns the outer declaration's type, not the
 * inner component `sub`'s type, since that requires resolving `sub` against the
 * outer type.
 */
function declaringTypeOfModification(modification: Node): string | null {
  let n: Node | null = modification.parent;
  while (n) {
    if (n.type === "component_clause") {
      const ts = n.childForFieldName("typeSpecifier");
      return ts && ts.text.length > 0 ? ts.text : null;
    }
    if (n.type === "extends_clause") {
      const ts = n.childForFieldName("typeSpecifier") ?? firstNameChild(n);
      return ts && ts.text.length > 0 ? ts.text : null;
    }
    n = n.parent;
  }
  return null;
}

/**
 * Type of a name-less declaration the parser recovered as an `ERROR`: a
 * `type_specifier` directly followed by a `(` whose closing `)` (or the ERROR's
 * end, for an unterminated list) straddles the caret. Returns null when the
 * ERROR has no such `type_specifier (…)` shape around the caret.
 */
function declaringTypeFromErrorParens(
  error: Node,
  offset: number,
): string | null {
  for (let i = 0; i < error.childCount; i++) {
    const child = error.child(i);
    if (!child || child.type !== TYPE_SPECIFIER_NODE) continue;
    const open = error.child(i + 1);
    if (!open || open.type !== "(") continue;
    const close = closingParenAfter(error, i + 1);
    const upper = close ? close.endIndex : error.endIndex;
    if (offset >= open.endIndex && offset <= upper) {
      return child.text.length > 0 ? child.text : null;
    }
  }
  return null;
}

/**
 * The first `)` token after child index `from` within `node`, or null. Assumes
 * the `ERROR` holds a single flat `type_specifier (…)` shape: pairing is
 * positional, not paren-balanced, so a nested `(...)` flattened into the same
 * ERROR would mis-pair.
 */
function closingParenAfter(node: Node, from: number): Node | null {
  for (let i = from + 1; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === ")") return child;
  }
  return null;
}

/** First `type_specifier`/`name` child of a node, or null. */
function firstNameChild(node: Node): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (
      child &&
      (child.type === TYPE_SPECIFIER_NODE || child.type === NAME_NODE)
    ) {
      return child;
    }
  }
  return null;
}

/**
 * Classify the context of `ident`, given the dotted `name`/`component_reference`
 * node it lives in (or `null` for a bare identifier).
 */
export function classify(ident: Node, dotted: Node | null): CursorContextKind {
  // A cref segment that follows a `.` is a member access.
  if (dotted?.type === CREF_NODE) {
    return isMemberSegment(ident, dotted)
      ? "member-access"
      : "component-reference";
  }

  if (dotted?.type === NAME_NODE) {
    // Walk up out of the (possibly nested) `name` to find its role.
    const role = nameRole(dotted);
    if (role) return role;
    // A `name` not in a recognized slot is still a type-ish reference.
    return "type-reference";
  }

  // Bare identifier: classify by the structural parent.
  return bareRole(ident);
}

/**
 * Walk up to the top of a left-recursive dotted node. tree-sitter nests
 * `name`/`component_reference` so the *outermost* one spans the whole dotted
 * path; from any inner segment we climb while the parent is the same kind.
 */
function topOfDotted(node: Node): Node {
  let top = node;
  while (top.parent && top.parent.type === top.type) {
    top = top.parent;
  }
  return top;
}

/**
 * The dotted `name`/`component_reference` node enclosing `ident`, or `null` if
 * the identifier is not part of a dotted path (a bare IDENT in some other slot).
 */
function enclosingDottedNode(ident: Node): Node | null {
  let n: Node | null = ident.parent;
  while (n) {
    if (n.type === NAME_NODE || n.type === CREF_NODE) return topOfDotted(n);
    // Stop climbing once we leave name/cref territory.
    if (n.type !== IDENT_NODE) break;
    n = n.parent;
  }
  return null;
}

/**
 * Ordered `IDENT` segment nodes of a left-recursive dotted
 * `name`/`component_reference`. tree-sitter nests each level so the left child
 * is the (smaller) prefix and the right `IDENT` is this level's segment; an
 * in-order walk therefore yields the segments left-to-right. Callers project
 * out whatever they need (`.text`, `.startIndex`, `.endIndex`) — see
 * {@link segmentsOf}, {@link segmentsUpTo}, {@link isMemberSegment}.
 */
function segmentNodes(dotted: Node): Node[] {
  const out: Node[] = [];
  collectSegmentNodes(dotted, out);
  return out;
}

function collectSegmentNodes(node: Node, out: Node[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === node.type) {
      collectSegmentNodes(child, out);
    } else if (child.type === IDENT_NODE) {
      out.push(child);
    }
  }
}

/** Ordered identifier segments of a dotted `name`/`component_reference`. */
function segmentsOf(dotted: Node): string[] {
  return segmentNodes(dotted).map((n) => n.text);
}

/** Segments of `dotted` up to and including the segment `ident`. */
function segmentsUpTo(dotted: Node, ident: Node): string[] {
  const result: string[] = [];
  for (const seg of segmentNodes(dotted)) {
    result.push(seg.text);
    if (seg.endIndex >= ident.endIndex) break;
  }
  return result;
}

/**
 * Is `ident` a non-head segment of a dotted cref (i.e. preceded by a `.`)? The
 * head segment of `a.b.c` is `a`; `b` and `c` are member accesses.
 */
function isMemberSegment(ident: Node, dotted: Node): boolean {
  const segs = segmentNodes(dotted);
  if (segs.length <= 1) return false;
  const headStart = segs[0]?.startIndex ?? ident.startIndex;
  return ident.startIndex > headStart;
}

/**
 * Role of a dotted `name` node from its enclosing structure:
 * `extends_clause` → "extends"; `component_clause`'s `typeSpecifier` →
 * "component-type"; `element_modification`'s `name` → "modifier-name".
 */
function nameRole(dotted: Node): CursorContextKind | null {
  // The `name` may be wrapped in a `type_specifier`; climb past it.
  let n: Node | null = dotted.parent;
  if (n?.type === TYPE_SPECIFIER_NODE) n = n.parent;
  switch (n?.type) {
    case "extends_clause":
      return "extends";
    case "component_clause":
      return "component-type";
    case "element_modification":
      return "modifier-name";
    // `import_clause` and any unrecognized slot fall through to `null`, which
    // `classify` resolves to `"type-reference"` — the safe fallback for a
    // dotted `name` whose role we don't have a more specific kind for.
    default:
      return null;
  }
}

/** Role of a bare identifier from its immediate structural parent. */
function bareRole(ident: Node): CursorContextKind {
  const parent = ident.parent;
  switch (parent?.type) {
    case TYPE_SPECIFIER_NODE:
      // A single-segment type name (e.g. `Resistor`) — refine via grandparent.
      return nameRole(parent) ?? "type-reference";
    case CREF_NODE:
      return "component-reference";
    case "element_modification":
      return "modifier-name";
    default:
      return "unknown";
  }
}
