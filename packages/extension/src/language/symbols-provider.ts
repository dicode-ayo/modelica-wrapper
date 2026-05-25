/**
 * Document-symbols / outline provider — the one language feature that needs
 * **no OMC** (issue #98). It walks the tree-sitter tree alone, so the Outline,
 * breadcrumbs, and folding work even before (or entirely without) a loaded
 * model.
 *
 * ## Pure / impure split (testability)
 *
 * Mirrors `definition-provider.ts` / `hover-provider.ts`: the whole tree walk
 * lives in {@link computeDocumentSymbols}, a pure function with NO `vscode`
 * import. It takes a tree-sitter `Tree` and returns a hierarchy of
 * {@link SymbolNode}s carrying plain offset/row-col data (a local
 * {@link SymbolKind} enum, plus {@link ZeroBasedRange}s). That core is
 * unit-tested against real grammar-WASM fixture trees (see
 * `symbols-provider.test.ts`). The `vscode.DocumentSymbolProvider` wrapper
 * ({@link ModelicaDocumentSymbolProvider}) is a thin shell that parses the
 * buffer, calls the core, and maps the plain nodes onto `vscode.DocumentSymbol`
 * via {@link toVscodeSymbolKind}.
 *
 * ## Grammar shapes this relies on (OpenModelica/tree-sitter-modelica v0.2.2)
 *
 * - The root is `stored_definitions` → `stored_definition` →
 *   `class_definition`.
 * - A `class_definition` has a `classPrefixes` field (a `class_prefixes` node
 *   whose text is the restriction keyword run, e.g. `partial block` /
 *   `operator record` / `expandable connector`) and a `classSpecifier` field
 *   (`long_class_specifier` for `model … end` forms, `short_class_specifier`
 *   for `type X = …` aliases). The specifier carries the `identifier` field
 *   (the class name `IDENT`), an optional `descriptionString` (the doc comment),
 *   and — for the long form — a nested `element_list`.
 * - An element-list section holds `element` children that wrap either a nested
 *   `class_definition` (via a `named_element`) or a `component_clause` (a
 *   variable/parameter declaration), plus `extends_clause`s we skip. A
 *   `long_class_specifier` carries up to three such sibling sections in source
 *   order: the default `element_list`, plus `public_element_list` /
 *   `protected_element_list` for members under a `public` / `protected` keyword.
 *   All three must be walked or visibility-section members are dropped.
 * - A `component_clause` has anonymous prefix tokens (`parameter` / `constant`
 *   / `input` / `output` / `flow` / …) before its `typeSpecifier`, then a
 *   `componentDeclarations` (`component_list`) of one or more
 *   `component_declaration`s — each `declaration`'s `identifier` field is a
 *   declared name (so `Real a, b;` yields two symbols).
 *
 * Offsets are **UTF-16 code-unit offsets** (tree-sitter's string-input unit;
 * see `position.ts`) and `Point.row` / `Point.column` are 0-based UTF-16
 * row/column — already the unit VSCode speaks, so the wrapper builds a
 * `vscode.Range` straight from a {@link ZeroBasedRange}.
 */

import * as vscode from "vscode";

import type { Node, Tree } from "web-tree-sitter";

import { log } from "../logger.js";

import type { ParseCache } from "./parse.js";
import type { ZeroBasedPosition, ZeroBasedRange } from "./position.js";

/** Grammar node types this walk inspects. Kept as named constants (no magic strings). */
const NODE = {
  classDefinition: "class_definition",
  componentClause: "component_clause",
  componentList: "component_list",
  componentDeclaration: "component_declaration",
  declaration: "declaration",
  typeSpecifier: "type_specifier",
} as const;

/**
 * The element-list section node types under a `long_class_specifier`. The
 * default (no-keyword) section is `element_list`; members declared under a
 * `public` / `protected` keyword live in sibling `public_element_list` /
 * `protected_element_list` nodes. All three carry `element` children of the
 * same shape, so the member walk treats them uniformly.
 */
const ELEMENT_LIST_TYPES: ReadonlySet<string> = new Set([
  "element_list",
  "public_element_list",
  "protected_element_list",
]);

/** Class-definition field names (OpenModelica/tree-sitter-modelica v0.2.2). */
const FIELD = {
  classPrefixes: "classPrefixes",
  classSpecifier: "classSpecifier",
  identifier: "identifier",
  descriptionString: "descriptionString",
  value: "value",
  componentDeclarations: "componentDeclarations",
  declaration: "declaration",
} as const;

/**
 * Class-prefix *modifier* keywords that precede the actual restriction in a
 * `class_prefixes` run (e.g. `partial block`, `expandable connector`,
 * `pure function`). We strip these to find the restriction keyword that decides
 * the {@link SymbolKind}, scanning right-to-left so a trailing restriction wins.
 *
 * Only keywords the grammar actually keeps *inside* `class_prefixes` belong
 * here. `redeclare` / `replaceable` / `inner` / `outer` / `encapsulated` /
 * `final` are parsed *outside* `class_prefixes` (verified against the vendored
 * grammar), so they never reach this set and are deliberately omitted.
 *
 * `operator` is intentionally NOT a modifier: a bare `operator` class (whose
 * `class_prefixes` text is just `operator`) must reach the Function mapping in
 * {@link classKind}. Compound forms still resolve correctly because the
 * right-to-left scan picks the trailing restriction first: `operator function`
 * → `function`, `operator record` → `record`.
 */
const CLASS_PREFIX_MODIFIERS: ReadonlySet<string> = new Set([
  "partial",
  "expandable",
  "pure",
  "impure",
]);

/** Component-prefix keywords that mark a declaration as a parameter/constant. */
const PARAMETER_PREFIX = "parameter";
const CONSTANT_PREFIX = "constant";

/**
 * A restriction-keyword–neutral symbol kind, mirroring the subset of
 * `vscode.SymbolKind` the outline uses. The pure walk stays free of `vscode`
 * by emitting these; the thin provider maps each to the real enum via
 * {@link toVscodeSymbolKind}.
 */
export enum SymbolKind {
  /** `package`. */
  Package = "package",
  /** `function` / `operator`. */
  Function = "function",
  /** `record`. */
  Struct = "struct",
  /** `connector`. */
  Interface = "interface",
  /** `type` (alias) / `enumeration`. */
  Enum = "enum",
  /** `model` / `block` / `class` and any unrecognised restriction. */
  Class = "class",
  /** A `parameter` component. */
  Property = "property",
  /** A `constant` component. */
  Constant = "constant",
  /** A plain declared variable/component. */
  Field = "field",
}

/**
 * A node in the document-symbol hierarchy, as plain data (no `vscode` types).
 * `range` spans the whole declaration; `selectionRange` is the identifier the
 * editor highlights/reveals; `children` are the members nested inside.
 */
export interface SymbolNode {
  readonly name: string;
  readonly kind: SymbolKind;
  /** The class's doc comment (description string), if any — shown as detail. */
  readonly detail?: string;
  /** Whole declaration span. */
  readonly range: ZeroBasedRange;
  /** The identifier span (what the editor reveals on select). */
  readonly selectionRange: ZeroBasedRange;
  readonly children: SymbolNode[];
}

/**
 * Walk `tree` and produce the document-symbol hierarchy. Pure: takes only a
 * tree-sitter `Tree`, returns plain {@link SymbolNode}s. Never throws — a
 * malformed or empty buffer (tree-sitter still returns a tree, just with error
 * nodes) yields whatever well-formed declarations it could recover, or `[]`.
 *
 * @param tree - parsed buffer (from `ParseCache.parse`).
 */
export function computeDocumentSymbols(tree: Tree): SymbolNode[] {
  const root = tree.rootNode;
  if (!root) return [];
  return collectClasses(root);
}

/**
 * Collect the top-level class symbols reachable from `node`. The grammar nests
 * the top class under `stored_definitions` → `stored_definition`; we descend
 * generically (rather than assuming exact wrappers) so a partial parse still
 * surfaces what it can.
 */
function collectClasses(node: Node): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === NODE.classDefinition) {
      const symbol = classSymbol(child);
      if (symbol) out.push(symbol);
    } else if (child.namedChildCount > 0) {
      // Descend through wrapper nodes (stored_definition, element, …) until we
      // reach class_definitions. We don't recurse into a class_definition here
      // — its members are walked by classSymbol's element-list pass.
      out.push(...collectClasses(child));
    }
  }
  return out;
}

/** Build a {@link SymbolNode} for a `class_definition`, or `null` if unnamed. */
function classSymbol(classDef: Node): SymbolNode | null {
  const specifier = classDef.childForFieldName(FIELD.classSpecifier);
  const identifier = specifier?.childForFieldName(FIELD.identifier) ?? null;
  if (!specifier || !identifier) return null;

  const prefixes = classDef.childForFieldName(FIELD.classPrefixes);
  const kind = classKind(prefixes?.text ?? "");
  const detail = descriptionOf(specifier);

  // Members live across up to three sibling element-list sections (default,
  // public, protected). Walk each in source order so the outline preserves the
  // declaration order even across visibility keywords.
  const children: SymbolNode[] = [];
  for (let i = 0; i < specifier.namedChildCount; i++) {
    const section = specifier.namedChild(i);
    if (section && ELEMENT_LIST_TYPES.has(section.type)) {
      collectMembers(section, children);
    }
  }

  return {
    name: identifier.text,
    kind,
    ...(detail !== undefined ? { detail } : {}),
    range: rangeOf(classDef),
    selectionRange: rangeOf(identifier),
    children,
  };
}

/**
 * Collect the member symbols from one element-list section (`element_list`,
 * `public_element_list`, or `protected_element_list`): nested classes
 * (recursively) and component declarations. The `public` / `protected` keyword
 * tokens are anonymous (unnamed) children, so iterating named children skips
 * them. `extends_clause`s and other elements are skipped — they aren't outline
 * symbols.
 */
function collectMembers(elementList: Node, out: SymbolNode[]): void {
  for (let i = 0; i < elementList.namedChildCount; i++) {
    const element = elementList.namedChild(i);
    if (!element) continue;
    // `element` may be a `named_element` wrapper or (for an extends) the clause
    // itself. Look just inside for the meaningful node.
    const nested = findChild(element, NODE.classDefinition);
    if (nested) {
      const symbol = classSymbol(nested);
      if (symbol) out.push(symbol);
      continue;
    }
    const componentClause = findChild(element, NODE.componentClause);
    if (componentClause) collectComponents(componentClause, out);
  }
}

/**
 * Emit one {@link SymbolNode} per declared name in a `component_clause`. A
 * single clause can declare several components (`Real a, b, c;`), so each
 * `component_declaration` yields its own symbol; they share the clause's
 * parameter/constant kind but get their own identifier selection range.
 */
function collectComponents(clause: Node, out: SymbolNode[]): void {
  const kind = componentKind(clause);
  const list = clause.childForFieldName(FIELD.componentDeclarations);
  if (!list) return;
  for (let i = 0; i < list.namedChildCount; i++) {
    const decl = list.namedChild(i);
    if (!decl || decl.type !== NODE.componentDeclaration) continue;
    const declaration = decl.childForFieldName(FIELD.declaration);
    const identifier = declaration?.childForFieldName(FIELD.identifier) ?? null;
    if (!identifier) continue;
    out.push({
      name: identifier.text,
      kind,
      range: rangeOf(decl),
      selectionRange: rangeOf(identifier),
      children: [],
    });
  }
}

/**
 * Map the `class_prefixes` text (e.g. `partial block`, `operator record`,
 * `type`) to a {@link SymbolKind}. The restriction is the final keyword once
 * the modifier prefixes (`partial`, `operator`, …) are stripped.
 */
export function classKind(classPrefixesText: string): SymbolKind {
  const restriction = restrictionKeyword(classPrefixesText);
  switch (restriction) {
    case "package":
      return SymbolKind.Package;
    case "function":
      return SymbolKind.Function;
    case "operator":
      // A bare `operator` class (no `record`/`function` suffix) reaches here
      // because `operator` is not stripped as a modifier; it's closest to a
      // function group. (`operator function` / `operator record` resolve to
      // their trailing restriction instead.)
      return SymbolKind.Function;
    case "record":
      return SymbolKind.Struct;
    case "connector":
      return SymbolKind.Interface;
    case "type":
      return SymbolKind.Enum;
    case "model":
    case "block":
    case "class":
    default:
      return SymbolKind.Class;
  }
}

/** The restriction keyword from a class-prefix run, or `""` if none remains. */
function restrictionKeyword(classPrefixesText: string): string {
  const words = classPrefixesText.trim().split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (word && !CLASS_PREFIX_MODIFIERS.has(word)) return word;
  }
  return "";
}

/**
 * Kind for a component declaration: a `parameter` reads as Property, a
 * `constant` as Constant, anything else as a plain Field. The prefix keywords
 * are anonymous tokens before the clause's `type_specifier`.
 */
function componentKind(clause: Node): SymbolKind {
  for (let i = 0; i < clause.childCount; i++) {
    const child = clause.child(i);
    if (!child) continue;
    if (child.type === NODE.typeSpecifier) break;
    if (child.isNamed) continue;
    if (child.type === PARAMETER_PREFIX) return SymbolKind.Property;
    if (child.type === CONSTANT_PREFIX) return SymbolKind.Constant;
  }
  return SymbolKind.Field;
}

/**
 * The class's doc comment, or `undefined` when absent/empty. Surfaced as the
 * symbol's `detail` so the outline shows it beside the name.
 *
 * A `description_string` may be a concatenation (`"a" + "b"`); its `value`
 * fields are the individual `STRING` literals. We read the first `value`'s text
 * and strip its quotes, rather than unquoting the whole node — the latter only
 * removes the outermost quotes and mangles concatenations into `a" + "b`.
 */
function descriptionOf(specifier: Node): string | undefined {
  const description = specifier.childForFieldName(FIELD.descriptionString);
  if (!description) return undefined;
  const value = description.childForFieldName(FIELD.value) ?? description;
  const text = unquote(value.text.trim());
  return text.length > 0 ? text : undefined;
}

/** Strip a single pair of surrounding double quotes from a string literal. */
function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * The topmost descendant of `node` (at any depth) with type `type`, in
 * preorder (depth-first, returning the first/shallowest match). Used to reach
 * the meaningful node inside a thin wrapper (`named_element` →
 * `class_definition` / `component_clause`).
 *
 * Intentionally a full descendant search, not a direct-child lookup: callers
 * pass thin one-level wrappers (a `named_element`) or a `class_specifier`
 * subtree, where the target is the topmost match — so preorder never reaches
 * into a *nested* class before finding the wrapped node. Do not point it at a
 * larger subtree where a nested class could shadow the intended match.
 */
function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === type) return child;
    const deeper = findChild(child, type);
    if (deeper) return deeper;
  }
  return null;
}

/** A tree-sitter node's 0-based UTF-16 row/column span as a {@link ZeroBasedRange}. */
function rangeOf(node: Node): ZeroBasedRange {
  return { start: pointOf(node.startPosition), end: pointOf(node.endPosition) };
}

/** tree-sitter `Point` (0-based UTF-16 row/column) → {@link ZeroBasedPosition}. */
function pointOf(point: { row: number; column: number }): ZeroBasedPosition {
  return { line: point.row, character: point.column };
}

/** Map the pure {@link SymbolKind} onto the real `vscode.SymbolKind`. */
export function toVscodeSymbolKind(kind: SymbolKind): vscode.SymbolKind {
  switch (kind) {
    case SymbolKind.Package:
      return vscode.SymbolKind.Package;
    case SymbolKind.Function:
      return vscode.SymbolKind.Function;
    case SymbolKind.Struct:
      return vscode.SymbolKind.Struct;
    case SymbolKind.Interface:
      return vscode.SymbolKind.Interface;
    case SymbolKind.Enum:
      return vscode.SymbolKind.Enum;
    case SymbolKind.Class:
      return vscode.SymbolKind.Class;
    case SymbolKind.Property:
      return vscode.SymbolKind.Property;
    case SymbolKind.Constant:
      return vscode.SymbolKind.Constant;
    case SymbolKind.Field:
      return vscode.SymbolKind.Field;
  }
}

/** Build a `vscode.Range` from a plain {@link ZeroBasedRange}. */
function toVscodeRange(range: ZeroBasedRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character),
  );
}

/** Recursively turn a {@link SymbolNode} into a `vscode.DocumentSymbol`. */
function toVscodeSymbol(node: SymbolNode): vscode.DocumentSymbol {
  const symbol = new vscode.DocumentSymbol(
    node.name,
    node.detail ?? "",
    toVscodeSymbolKind(node.kind),
    toVscodeRange(node.range),
    toVscodeRange(node.selectionRange),
  );
  symbol.children = node.children.map(toVscodeSymbol);
  return symbol;
}

/**
 * The `vscode.DocumentSymbolProvider` registered for Modelica buffers. Thin
 * wrapper over {@link computeDocumentSymbols}: parse the buffer, walk it, and
 * map the plain hierarchy onto `vscode.DocumentSymbol`s. No OMC. Never throws
 * out — a parse failure degrades to no symbols (`[]`).
 */
export class ModelicaDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  constructor(private readonly cache: ParseCache) {}

  async provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentSymbol[]> {
    try {
      const tree = await this.cache.parse(document);
      return computeDocumentSymbols(tree).map(toVscodeSymbol);
    } catch (err) {
      // A provider must never throw out — degrade to "no symbols".
      log.error("language", "document-symbol provider failed", err);
      return [];
    }
  }
}
