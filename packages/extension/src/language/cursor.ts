/**
 * Pure, syntactic cursor analysis over a tree-sitter Modelica tree.
 *
 * Nothing here imports `vscode` or talks to OMC — every function takes a
 * `Node`/`Tree` and a byte offset and returns plain data, so the whole module
 * is unit-testable against fixture trees (see `cursor.test.ts`). The semantic
 * half (resolving a name to a definition) lives in `resolve.ts` in a later PR.
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
  /** Byte range of the single identifier under the cursor. */
  readonly startIndex: number;
  readonly endIndex: number;
}

/** The kinds of dotted-path node the grammar produces. */
const NAME_NODE = "name";
const CREF_NODE = "component_reference";
const IDENT_NODE = "IDENT";

/**
 * The named node at `offset`. Prefers a *named* descendant (skips anonymous
 * tokens like `.`, `(`, `;`) so callers get a meaningful node. When the offset
 * sits exactly on punctuation, the nearest named node is returned instead.
 */
export function nodeAt(tree: Tree, offset: number): Node | null {
  const named = tree.rootNode.namedDescendantForIndex(offset, offset);
  return named ?? null;
}

/**
 * The `IDENT` token at `offset`, if any. When the offset lands on a `.` between
 * two identifiers we bias to the identifier *before* the dot (the segment the
 * user most likely means when the caret is just past it).
 */
export function identifierAt(tree: Tree, offset: number): Node | null {
  let node = tree.rootNode.descendantForIndex(offset, offset);
  if (node && node.type === IDENT_NODE) return node;
  // On a dot or at a boundary: try one byte to the left.
  if (offset > 0) {
    node = tree.rootNode.descendantForIndex(offset - 1, offset - 1);
    if (node && node.type === IDENT_NODE) return node;
  }
  return null;
}

/**
 * Resolve the cursor at `offset` to the identifier under it, the dotted path it
 * belongs to, and the syntactic context. Returns `null` when the cursor is not
 * on an identifier (whitespace, keyword, punctuation).
 */
export function targetAt(tree: Tree, offset: number): CursorTarget | null {
  const ident = identifierAt(tree, offset);
  if (!ident) return null;

  const dotted = enclosingDottedNode(ident);
  const path = dotted ? segmentsOf(dotted) : [ident.text];
  const pathToCursor = dotted
    ? segmentsUpTo(dotted, ident)
    : [ident.text];

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
    // A `name` not in a recognised slot is still a type-ish reference.
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

/** Ordered identifier segments of a dotted `name`/`component_reference`. */
function segmentsOf(dotted: Node): string[] {
  const out: string[] = [];
  collectSegments(dotted, out);
  return out;
}

function collectSegments(node: Node, out: string[]): void {
  // Left-recursive: the left child is the (smaller) prefix, the right IDENT is
  // this level's segment. An in-order walk yields segments left-to-right.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === node.type) {
      collectSegments(child, out);
    } else if (child.type === IDENT_NODE) {
      out.push(child.text);
    }
  }
}

/** Segments of `dotted` up to and including the segment `ident`. */
function segmentsUpTo(dotted: Node, ident: Node): string[] {
  const all: { text: string; endIndex: number }[] = [];
  collectSegmentNodes(dotted, all);
  const result: string[] = [];
  for (const seg of all) {
    result.push(seg.text);
    if (seg.endIndex >= ident.endIndex) break;
  }
  return result;
}

function collectSegmentNodes(
  node: Node,
  out: { text: string; endIndex: number }[],
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === node.type) {
      collectSegmentNodes(child, out);
    } else if (child.type === IDENT_NODE) {
      out.push({ text: child.text, endIndex: child.endIndex });
    }
  }
}

/**
 * Is `ident` a non-head segment of a dotted cref (i.e. preceded by a `.`)? The
 * head segment of `a.b.c` is `a`; `b` and `c` are member accesses.
 */
function isMemberSegment(ident: Node, dotted: Node): boolean {
  const segs: { startIndex: number }[] = [];
  collectSegmentStarts(dotted, segs);
  if (segs.length <= 1) return false;
  const headStart = segs[0]?.startIndex ?? ident.startIndex;
  return ident.startIndex > headStart;
}

function collectSegmentStarts(
  node: Node,
  out: { startIndex: number }[],
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === node.type) {
      collectSegmentStarts(child, out);
    } else if (child.type === IDENT_NODE) {
      out.push({ startIndex: child.startIndex });
    }
  }
}

/**
 * Role of a dotted `name` node from its enclosing structure:
 * `extends_clause` → "extends"; `component_clause`'s `typeSpecifier` →
 * "component-type"; `element_modification`'s `name` → "modifier-name".
 */
function nameRole(dotted: Node): CursorContextKind | null {
  // The `name` may be wrapped in a `type_specifier`; climb past it.
  let n: Node | null = dotted.parent;
  if (n?.type === "type_specifier") n = n.parent;
  switch (n?.type) {
    case "extends_clause":
      return "extends";
    case "component_clause":
      return "component-type";
    case "element_modification":
      return "modifier-name";
    case "import_clause":
      return "type-reference";
    default:
      return null;
  }
}

/** Role of a bare identifier from its immediate structural parent. */
function bareRole(ident: Node): CursorContextKind {
  const parent = ident.parent;
  switch (parent?.type) {
    case "type_specifier":
      // A single-segment type name (e.g. `Resistor`) — refine via grandparent.
      return nameRole(parent) ?? "type-reference";
    case "component_reference":
      return "component-reference";
    case "element_modification":
      return "modifier-name";
    default:
      return "unknown";
  }
}
