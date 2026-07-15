/**
 * Semantic-token computation for Modelica annotation bodies. Pure and
 * `vscode`-free: walks a tree-sitter `Tree` and returns plain
 * {@link AnnotationToken}s (offset/row-col data only), so it is unit-tested
 * against grammar-WASM fixture trees. The `vscode`-facing
 * `AnnotationSemanticTokensProvider` (see `annotation-tokens-provider.ts`) maps
 * these onto `vscode.SemanticTokens`.
 *
 * ## Two syntactic worlds inside an annotation (OpenModelica/tree-sitter-modelica v0.2.2)
 *
 * An annotation nests records in two different shapes; the walk covers both:
 *
 *  1. *Modification* syntax — `Diagram(coordinateSystem(…), graphics=…)`. Each
 *     entry is an `element_modification` with a `name` field and a
 *     `modification` field. A `modification` wrapping a nested
 *     `class_modification` marks the name as a RECORD (`Diagram`,
 *     `coordinateSystem`); a `= expr` modification marks it as a FIELD
 *     (`graphics`, `extent`, `info`).
 *  2. *Expression* syntax — the graphic primitives inside `graphics={…}` are
 *     record-constructor calls: a `function_application` whose callee
 *     `component_reference` names the RECORD (`Line`, `Rectangle`) and whose
 *     `named_argument` names are FIELDS (`points`, `color`, `pattern`).
 *
 * Enum values (`pattern=LinePattern.Dash`) are dotted `component_reference`s
 * whose head names a spec graphical enum ({@link ANNOTATION_ENUM_NAMES}); the
 * whole reference is coloured as an enum member. Numbers and strings are left
 * to the TextMate grammar's baseline rules.
 */

import { ANNOTATION_ENUM_NAMES } from "@dicode/modelica-completion";

import type { Node, Tree } from "web-tree-sitter";

import type { ZeroBasedPosition, ZeroBasedRange } from "./position.js";

/** Grammar node/field names this walk inspects (no magic strings). */
const NODE = {
  annotationClause: "annotation_clause",
  elementModification: "element_modification",
  classModification: "class_modification",
  functionApplication: "function_application",
  componentReference: "component_reference",
  namedArgument: "named_argument",
  ident: "IDENT",
} as const;

const FIELD = {
  name: "name",
  modification: "modification",
} as const;

/**
 * The kind of an annotation token. The host provider maps each onto a standard
 * VSCode semantic-token type (see `annotation-tokens-provider.ts`).
 */
export enum AnnotationTokenType {
  /** A record name — `Diagram`, `Icon`, `Line`, `Rectangle`, `Documentation`. */
  Record = "record",
  /** A field name — `graphics`, `points`, `color`, `extent`, `info`. */
  Field = "field",
  /** A graphical-enum reference in value position — `LinePattern.Dash`. */
  EnumMember = "enumMember",
}

/** One classified span inside an annotation, as plain data (no `vscode`). */
export interface AnnotationToken {
  readonly range: ZeroBasedRange;
  readonly type: AnnotationTokenType;
}

/**
 * Walk `tree` and classify the record names, field names, and enum references in
 * every annotation it contains. Pure: takes only a tree-sitter `Tree`, returns
 * plain {@link AnnotationToken}s in document order. Never throws — a malformed
 * buffer yields whatever well-formed annotation spans could be recovered, or an
 * empty array.
 */
export function computeAnnotationTokens(tree: Tree): AnnotationToken[] {
  const root = tree.rootNode;
  if (!root) return [];
  const out: AnnotationToken[] = [];
  for (const annotation of annotationClauses(root)) {
    walkAnnotation(annotation, out);
  }
  return out;
}

/** Every `annotation_clause` in the tree (class-level, component, connect, …). */
function annotationClauses(root: Node): Node[] {
  const found: Node[] = [];
  const visit = (node: Node): void => {
    if (node.type === NODE.annotationClause) {
      found.push(node);
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  };
  visit(root);
  return found;
}

/**
 * Classify the annotation subtree rooted at `node`, appending tokens in document
 * order. Recurses through the whole subtree so nested records/fields in both the
 * modification and expression worlds are reached.
 */
function walkAnnotation(node: Node, out: AnnotationToken[]): void {
  switch (node.type) {
    case NODE.elementModification:
      classifyElementModification(node, out);
      break;
    case NODE.functionApplication:
      classifyRecordConstructor(node, out);
      break;
    case NODE.namedArgument:
      classifyNamedArgument(node, out);
      break;
    case NODE.componentReference:
      classifyEnumReference(node, out);
      break;
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkAnnotation(child, out);
  }
}

/**
 * An `element_modification` names a RECORD when its `modification` wraps a nested
 * `class_modification` (`Diagram(…)`), otherwise a FIELD (`graphics = …`, or a
 * bare name with no value).
 */
function classifyElementModification(node: Node, out: AnnotationToken[]): void {
  const name = node.childForFieldName(FIELD.name);
  if (!name) return;
  const modification = node.childForFieldName(FIELD.modification);
  const type = wrapsClassModification(modification)
    ? AnnotationTokenType.Record
    : AnnotationTokenType.Field;
  out.push({ range: rangeOf(name), type });
}

/** Whether a `modification` node directly wraps a nested `class_modification`. */
function wrapsClassModification(modification: Node | null): boolean {
  if (!modification) return false;
  for (let i = 0; i < modification.childCount; i++) {
    if (modification.child(i)?.type === NODE.classModification) return true;
  }
  return false;
}

/**
 * A `function_application` inside an annotation is a record constructor
 * (`Line(…)`); its callee `component_reference` names the RECORD. The named
 * arguments are handled separately as they are reached by the walk.
 */
function classifyRecordConstructor(node: Node, out: AnnotationToken[]): void {
  const callee = node.child(0);
  if (!callee || callee.type !== NODE.componentReference) return;
  const ident = firstIdent(callee);
  if (ident)
    out.push({ range: rangeOf(ident), type: AnnotationTokenType.Record });
}

/** A `named_argument`'s leading `IDENT` is a record-constructor FIELD name. */
function classifyNamedArgument(node: Node, out: AnnotationToken[]): void {
  const ident = firstIdent(node);
  if (ident)
    out.push({ range: rangeOf(ident), type: AnnotationTokenType.Field });
}

/**
 * A dotted `component_reference` (`Enum.Member`) whose head names a spec
 * graphical enum is coloured, as a whole, as an enum member. A bare
 * `component_reference` (a single `IDENT`, e.g. a record-constructor callee) is
 * left alone — it is classified by its enclosing node, not here.
 */
function classifyEnumReference(node: Node, out: AnnotationToken[]): void {
  const head = node.child(0);
  if (!head || head.type !== NODE.componentReference) return;
  const headIdent = firstIdent(head);
  if (!headIdent || !ANNOTATION_ENUM_NAMES.has(headIdent.text)) return;
  out.push({ range: rangeOf(node), type: AnnotationTokenType.EnumMember });
}

/** The first `IDENT` in `node`'s subtree, in preorder, or `null`. */
function firstIdent(node: Node): Node | null {
  if (node.type === NODE.ident) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const found = firstIdent(child);
    if (found) return found;
  }
  return null;
}

/** A node's 0-based UTF-16 row/column span as a {@link ZeroBasedRange}. */
function rangeOf(node: Node): ZeroBasedRange {
  return { start: pointOf(node.startPosition), end: pointOf(node.endPosition) };
}

/** tree-sitter `Point` (0-based UTF-16 row/column) → {@link ZeroBasedPosition}. */
function pointOf(point: { row: number; column: number }): ZeroBasedPosition {
  return { line: point.row, character: point.column };
}
