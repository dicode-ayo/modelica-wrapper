/**
 * Decoder for §18.6 graphic primitives.
 *
 * OMC emits each Modelica shape as a tagged record:
 *   `{ $kind: "record", name: "Polygon"|"Line"|"Rectangle"|"Ellipse"|"Text"|"Bitmap",
 *      elements: Expression[] }`
 *
 * The `elements` array is positional, in the order each record's modifiers
 * appear in the Modelica spec (§18.6). All shapes start with `GraphicItem`
 * fields (`visible, origin, rotation`); `FilledShape` adds five more
 * (`lineColor, fillColor, pattern, fillPattern, lineThickness`); per-shape
 * positional fields follow.
 *
 * IMPORTANT: the positional layout below was cross-checked against actual
 * OMC 1.26.7 captures of `Modelica.Blocks.Math.Sin` and
 * `Modelica.Blocks.Examples.PID_Controller`. For `Text`,
 * OMC's emission order differs from the spec wording: it produces
 * `extent, textString, fontSize, textColor, fontName, textStyle,
 * horizontalAlignment` rather than the spec's
 * `extent, textString, fontSize, fontName, textStyle, textColor,
 * horizontalAlignment`. We follow OMC's order — that's what's on the wire.
 *
 * The decoder is best-effort: missing trailing fields are dropped, unknown
 * trailing fields beyond the documented length are ignored, and
 * `null`/`undefined` slots translate to "field not set" (omitted on the
 * output object). A shape with an undecodable REQUIRED field (e.g. Polygon
 * without a points array, Rectangle without an extent) throws — better to
 * fail loud during fixture testing than emit silent garbage.
 */

import type {
  CallExpr,
  EnumLiteral,
  Expression,
  RecordValue,
} from "../../_shared/modelInstance.js";
import type { Value } from "../../parse.js";
import type {
  BitmapShape,
  Color,
  EllipseShape,
  Extent,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
  Point,
} from "../../_shared/diagramLayout.js";
import {
  evaluateExpression,
  type EnumLiteralValue,
  type EvalScope,
  type EvalValue,
} from "../../eval/expression-evaluator.js";

// ----- low-level positional helpers -----

/**
 * Strip an enum literal down to its symbolic name (e.g.
 * `LinePattern.Solid` → `"Solid"`). We keep ONLY the unqualified suffix:
 * downstream renderers map `"Solid"`, `"Dash"`, … straight to their style
 * vocabulary. If the name has no dot (rare), the whole string is returned.
 */
function enumName(e: EnumLiteral): string {
  const idx = e.name.lastIndexOf(".");
  return idx >= 0 ? e.name.slice(idx + 1) : e.name;
}

/**
 * Peel a `DynamicSelect(staticDefault, dynamicExpr)` wrapper down to its
 * STATIC default. OMC emits this around any per-instance-evaluated graphic
 * field (e.g. an Integrator's signal-line points reshape based on
 * `use_reset`). For a static layout we use the default; renderers that
 * want per-instance evaluation can preserve the wrapper at the
 * `textString` level (Text shapes keep the full Expression tree).
 *
 * Recursive peel — DynamicSelect can in principle nest; we keep peeling
 * until the head is no longer a DynamicSelect call.
 */
function peelDynamicSelect(v: Expression | undefined): Expression | undefined {
  let cur = v;
  while (
    cur &&
    typeof cur === "object" &&
    !Array.isArray(cur) &&
    (cur as { $kind?: unknown }).$kind === "call" &&
    (cur as { name?: unknown }).name === "DynamicSelect"
  ) {
    const args = (cur as { arguments?: Expression[] }).arguments;
    if (!args || args.length === 0) return undefined;
    cur = args[0];
  }
  return cur;
}

/**
 * True when `v` is already a literal the `as*` helpers below can decode
 * directly — a primitive, an array of literals, an enum literal, or a
 * record. Anything else (`binary_op`, `unary_op`, `cref`, `if`, `call`,
 * a bare key/value object) needs `evaluateExpression` first.
 */
function isLiteralExpr(v: Expression): boolean {
  if (v === null) return true;
  if (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(v)) return v.every(isLiteralExpr);
  if (typeof v === "object") {
    const kind = (v as { $kind?: unknown }).$kind;
    return kind === "enum" || kind === "record";
  }
  return false;
}

/**
 * Narrow an `EvalValue` back down to the `Expression` shape the `as*`
 * helpers expect. `EnumLiteralValue.index` is optional (some callers
 * synthesize enum literals without one); `EnumLiteral.index` is required,
 * so an evaluated enum without a numeric index can't be represented and
 * coercion fails rather than fabricating an index.
 */
function coerceEvalValueToExpression(v: EvalValue): Expression | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean"
  ) {
    return v;
  }
  if (Array.isArray(v)) {
    const out: Expression[] = [];
    for (const item of v) {
      const coerced = coerceEvalValueToExpression(item);
      if (coerced === undefined) return undefined;
      out.push(coerced);
    }
    return out;
  }
  const kind = (v as { $kind?: unknown }).$kind;
  if (kind === "enum") {
    const tagged = v as EnumLiteralValue;
    return typeof tagged.index === "number"
      ? { $kind: "enum", name: tagged.name, index: tagged.index }
      : undefined;
  }
  if (kind === "record") return v as RecordValue;
  return undefined;
}

/**
 * Peel `DynamicSelect`, then — when `scope` is given and the peeled value
 * isn't already a literal — evaluate it against that scope (issue #605).
 * OMC leaves many §18.6 fields as unreduced expression ASTs when they're
 * parameter-driven (`visible = not useSupport`); without this every such
 * field silently fell back to its default. An unresolvable expression
 * still falls through to the peeled AST, which the caller's literal check
 * rejects the same as before — fails open, matching OMEdit.
 */
function resolveExpr(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): Expression | undefined {
  const peeled = peelDynamicSelect(v);
  if (peeled === undefined || scope === undefined) return peeled;
  if (isLiteralExpr(peeled)) return peeled;
  const evaluated = evaluateExpression(peeled, scope);
  if (evaluated === undefined) return peeled;
  const coerced = coerceEvalValueToExpression(evaluated);
  return coerced === undefined ? peeled : coerced;
}

/** True if v is a 2-element tuple of finite numbers. */
function isPoint(v: Expression | undefined): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function asPoints(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): Point[] | undefined {
  const w = resolveExpr(v, scope);
  if (!Array.isArray(w)) return undefined;
  const out: Point[] = [];
  for (const p of w) {
    if (!isPoint(p)) return undefined;
    out.push([p[0], p[1]]);
  }
  return out;
}

function asExtent(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): Extent | undefined {
  const w = resolveExpr(v, scope);
  if (!Array.isArray(w) || w.length !== 2) return undefined;
  const a = w[0];
  const b = w[1];
  if (!isPoint(a) || !isPoint(b)) return undefined;
  return [
    [a[0], a[1]],
    [b[0], b[1]],
  ];
}

function asColor(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): Color | undefined {
  const w = resolveExpr(v, scope);
  if (
    !Array.isArray(w) ||
    w.length !== 3 ||
    typeof w[0] !== "number" ||
    typeof w[1] !== "number" ||
    typeof w[2] !== "number"
  ) {
    return undefined;
  }
  return [w[0], w[1], w[2]];
}

function asNumber(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): number | undefined {
  const w = resolveExpr(v, scope);
  return typeof w === "number" && Number.isFinite(w) ? w : undefined;
}

function asString(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): string | undefined {
  const w = resolveExpr(v, scope);
  return typeof w === "string" ? w : undefined;
}

function asEnumString(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): string | undefined {
  const w = resolveExpr(v, scope);
  if (
    w &&
    typeof w === "object" &&
    !Array.isArray(w) &&
    (w as { $kind?: unknown }).$kind === "enum"
  ) {
    return enumName(w as EnumLiteral);
  }
  return undefined;
}

/** Decode the `Arrow` field on a Line: `[Arrow.None, Arrow.Filled]` etc. */
function asArrow(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): [string, string] | undefined {
  const w = resolveExpr(v, scope);
  if (!Array.isArray(w) || w.length !== 2) return undefined;
  const a = asEnumString(w[0], scope);
  const b = asEnumString(w[1], scope);
  if (a === undefined || b === undefined) return undefined;
  return [a, b];
}

function asStringArray(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): string[] | undefined {
  const w = resolveExpr(v, scope);
  if (!Array.isArray(w)) return undefined;
  // Modelica TextStyle is an array of TextStyle enum literals; OMC emits
  // them as enum records. We accept either bare strings or enum literals
  // and normalize to strings.
  const out: string[] = [];
  for (const item of w) {
    if (typeof item === "string") {
      out.push(item);
    } else {
      const e = asEnumString(item, scope);
      if (e === undefined) return undefined;
      out.push(e);
    }
  }
  return out;
}

/**
 * Per-shape `GraphicItem` fields parsed from a decoded prefix.
 */
interface GraphicItemFields {
  visible?: boolean | undefined;
  origin?: Point | undefined;
  rotation?: number | undefined;
  offset: number;
}

/**
 * Helper for the `[visible, origin, rotation]` triple at the start of every
 * GraphicItem (§18.6). Each graphic carries its OWN origin / rotation /
 * visibility, distinct from the component `Placement` (issue #76, item 15) —
 * a rotated arrowhead or an offset gauge needle is positioned by these, not
 * by the enclosing placement.
 *
 * Only NON-default values are surfaced (visible omitted when true, origin
 * omitted when {0,0}, rotation omitted when 0) so the common case stays a
 * bare shape and renderers can skip the transform entirely.
 */
function consumeGraphicItem(
  els: Expression[],
  scope: EvalScope | undefined,
): GraphicItemFields {
  // index 0 = visible (boolean); 1 = origin (Point); 2 = rotation (Real).
  const visibleRaw = asBool(els[0], scope);
  const origin = asPoint(els[1], scope);
  const rotation = asNumber(els[2], scope);
  const out: GraphicItemFields = { offset: 3 };
  // Drop defaults so an un-transformed shape stays clean.
  if (visibleRaw === false) out.visible = false;
  if (origin && (origin[0] !== 0 || origin[1] !== 0)) out.origin = origin;
  if (rotation !== undefined && rotation !== 0) out.rotation = rotation;
  return out;
}

/** Single Point from a `[x, y]` tuple (peels DynamicSelect, evaluates against `scope`). */
function asPoint(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): Point | undefined {
  const w = resolveExpr(v, scope);
  return isPoint(w) ? [w[0], w[1]] : undefined;
}

/** Boolean from a literal (peels DynamicSelect, evaluates against `scope`). */
function asBool(
  v: Expression | undefined,
  scope: EvalScope | undefined,
): boolean | undefined {
  const w = resolveExpr(v, scope);
  return typeof w === "boolean" ? w : undefined;
}

/** Spread of the non-default GraphicItem fields onto a decoded shape. */
function graphicItemSpread(g: GraphicItemFields): {
  visible?: boolean;
  origin?: Point;
  rotation?: number;
} {
  const out: { visible?: boolean; origin?: Point; rotation?: number } = {};
  if (g.visible !== undefined) out.visible = g.visible;
  if (g.origin !== undefined) out.origin = g.origin;
  if (g.rotation !== undefined) out.rotation = g.rotation;
  return out;
}

/**
 * Helper for the `[lineColor, fillColor, pattern, fillPattern, lineThickness]`
 * five-tuple of FilledShape. Returns the slice and the offset just past it.
 */
function consumeFilledShape(
  els: Expression[],
  start: number,
  scope: EvalScope | undefined,
): {
  lineColor?: Color | undefined;
  fillColor?: Color | undefined;
  pattern?: string | undefined;
  fillPattern?: string | undefined;
  lineThickness?: number | undefined;
  offset: number;
} {
  return {
    lineColor: asColor(els[start + 0], scope),
    fillColor: asColor(els[start + 1], scope),
    pattern: asEnumString(els[start + 2], scope),
    fillPattern: asEnumString(els[start + 3], scope),
    lineThickness: asNumber(els[start + 4], scope),
    offset: start + 5,
  };
}

// ----- per-shape decoders -----

function decodeLine(
  els: Expression[],
  scope: EvalScope | undefined,
): LineShape {
  // GraphicItem(3) + points + color + pattern + thickness + arrow + arrowSize + smooth.
  // Line is GraphicItem only — NOT FilledShape.
  const gi = consumeGraphicItem(els, scope);
  const offset = gi.offset;
  const points = asPoints(els[offset], scope);
  if (!points) {
    throw new Error(
      `decodeLine: expected points array at index ${offset}, got ${JSON.stringify(els[offset])}`,
    );
  }
  const out: LineShape = { kind: "line", points, ...graphicItemSpread(gi) };
  const color = asColor(els[offset + 1], scope);
  if (color) out.color = color;
  const pattern = asEnumString(els[offset + 2], scope);
  if (pattern) out.pattern = pattern;
  const thickness = asNumber(els[offset + 3], scope);
  if (thickness !== undefined) out.thickness = thickness;
  const arrow = asArrow(els[offset + 4], scope);
  if (arrow) out.arrow = arrow;
  const arrowSize = asNumber(els[offset + 5], scope);
  if (arrowSize !== undefined) out.arrowSize = arrowSize;
  const smooth = asEnumString(els[offset + 6], scope);
  if (smooth) out.smooth = smooth;
  return out;
}

function decodePolygon(
  els: Expression[],
  scope: EvalScope | undefined,
): PolygonShape {
  // GraphicItem(3) + FilledShape(5) + points + smooth.
  const gi = consumeGraphicItem(els, scope);
  const fs = consumeFilledShape(els, gi.offset, scope);
  const points = asPoints(els[fs.offset], scope);
  if (!points) {
    throw new Error(
      `decodePolygon: expected points array at index ${fs.offset}, got ${JSON.stringify(els[fs.offset])}`,
    );
  }
  const out: PolygonShape = {
    kind: "polygon",
    points,
    ...graphicItemSpread(gi),
  };
  if (fs.lineColor) out.lineColor = fs.lineColor;
  if (fs.fillColor) out.fillColor = fs.fillColor;
  if (fs.pattern) out.pattern = fs.pattern;
  if (fs.fillPattern) out.fillPattern = fs.fillPattern;
  if (fs.lineThickness !== undefined) out.lineThickness = fs.lineThickness;
  const smooth = asEnumString(els[fs.offset + 1], scope);
  if (smooth) out.smooth = smooth;
  return out;
}

function decodeRectangle(
  els: Expression[],
  scope: EvalScope | undefined,
): RectangleShape {
  // GraphicItem(3) + FilledShape(5) + borderPattern + extent + radius.
  const gi = consumeGraphicItem(els, scope);
  const fs = consumeFilledShape(els, gi.offset, scope);
  const borderPattern = asEnumString(els[fs.offset], scope);
  const extent = asExtent(els[fs.offset + 1], scope);
  if (!extent) {
    throw new Error(
      `decodeRectangle: expected extent at index ${fs.offset + 1}, got ${JSON.stringify(els[fs.offset + 1])}`,
    );
  }
  const radius = asNumber(els[fs.offset + 2], scope);
  const out: RectangleShape = {
    kind: "rectangle",
    extent,
    ...graphicItemSpread(gi),
  };
  if (fs.lineColor) out.lineColor = fs.lineColor;
  if (fs.fillColor) out.fillColor = fs.fillColor;
  if (fs.pattern) out.pattern = fs.pattern;
  if (fs.fillPattern) out.fillPattern = fs.fillPattern;
  if (fs.lineThickness !== undefined) out.lineThickness = fs.lineThickness;
  if (borderPattern) out.borderPattern = borderPattern;
  if (radius !== undefined) out.radius = radius;
  return out;
}

function decodeEllipse(
  els: Expression[],
  scope: EvalScope | undefined,
): EllipseShape {
  // GraphicItem(3) + FilledShape(5) + extent + startAngle + endAngle + closure.
  const gi = consumeGraphicItem(els, scope);
  const fs = consumeFilledShape(els, gi.offset, scope);
  const extent = asExtent(els[fs.offset], scope);
  if (!extent) {
    throw new Error(
      `decodeEllipse: expected extent at index ${fs.offset}, got ${JSON.stringify(els[fs.offset])}`,
    );
  }
  const out: EllipseShape = {
    kind: "ellipse",
    extent,
    ...graphicItemSpread(gi),
  };
  if (fs.lineColor) out.lineColor = fs.lineColor;
  if (fs.fillColor) out.fillColor = fs.fillColor;
  if (fs.pattern) out.pattern = fs.pattern;
  if (fs.fillPattern) out.fillPattern = fs.fillPattern;
  if (fs.lineThickness !== undefined) out.lineThickness = fs.lineThickness;
  const startAngle = asNumber(els[fs.offset + 1], scope);
  if (startAngle !== undefined) out.startAngle = startAngle;
  const endAngle = asNumber(els[fs.offset + 2], scope);
  if (endAngle !== undefined) out.endAngle = endAngle;
  const closure = asEnumString(els[fs.offset + 3], scope);
  if (closure) out.closure = closure;
  return out;
}

function decodeText(
  els: Expression[],
  scope: EvalScope | undefined,
): TextShape {
  // GraphicItem(3) + FilledShape(5) + extent + textString + fontSize +
  //   textColor + fontName + textStyle + horizontalAlignment.
  // (OMC 1.26.7's emission order — see file header comment.)
  const gi = consumeGraphicItem(els, scope);
  const fs = consumeFilledShape(els, gi.offset, scope);
  const extent = asExtent(els[fs.offset], scope);
  if (!extent) {
    throw new Error(
      `decodeText: expected extent at index ${fs.offset}, got ${JSON.stringify(els[fs.offset])}`,
    );
  }
  const textString = els[fs.offset + 1];
  if (textString === undefined) {
    throw new Error(`decodeText: missing textString at index ${fs.offset + 1}`);
  }
  const out: TextShape = {
    kind: "text",
    extent,
    textString,
    ...graphicItemSpread(gi),
  };
  // FilledShape's lineColor often serves as the default for textColor in
  // Modelica; renderers can fall back to it. We don't surface lineColor
  // on TextShape since it's not used by Text otherwise.
  const fontSize = asNumber(els[fs.offset + 2], scope);
  if (fontSize !== undefined) out.fontSize = fontSize;
  const textColor = asColor(els[fs.offset + 3], scope);
  if (textColor) out.textColor = textColor;
  const fontName = asString(els[fs.offset + 4], scope);
  if (fontName !== undefined && fontName.length > 0) out.fontName = fontName;
  const textStyle = asStringArray(els[fs.offset + 5], scope);
  if (textStyle) out.textStyle = textStyle;
  const horizontalAlignment = asEnumString(els[fs.offset + 6], scope);
  if (horizontalAlignment) out.horizontalAlignment = horizontalAlignment;
  return out;
}

function decodeBitmap(
  els: Expression[],
  scope: EvalScope | undefined,
): BitmapShape {
  // GraphicItem(3) + extent + fileName + imageSource. Bitmap is NOT a
  // FilledShape — it has no line/fill color machinery.
  const gi = consumeGraphicItem(els, scope);
  const o1 = gi.offset;
  const extent = asExtent(els[o1], scope);
  if (!extent) {
    throw new Error(
      `decodeBitmap: expected extent at index ${o1}, got ${JSON.stringify(els[o1])}`,
    );
  }
  const out: BitmapShape = { kind: "bitmap", extent, ...graphicItemSpread(gi) };
  const fileName = asString(els[o1 + 1], scope);
  if (fileName !== undefined && fileName.length > 0) out.fileName = fileName;
  const imageSource = asString(els[o1 + 2], scope);
  if (imageSource !== undefined && imageSource.length > 0)
    out.imageSource = imageSource;
  return out;
}

/**
 * Decode a §18.6 graphic record into a typed `Shape`. Throws
 * `Error("decodeShape: unknown shape kind '<name>'")` for records the
 * decoder doesn't recognize — easier to surface a new `name` from a
 * future Modelica revision than to silently drop graphics.
 */
export function decodeShape(
  record: RecordValue,
  scope: EvalScope | undefined = undefined,
): Shape {
  const els = record.elements;
  switch (record.name) {
    case "Line":
      return decodeLine(els, scope);
    case "Polygon":
      return decodePolygon(els, scope);
    case "Rectangle":
      return decodeRectangle(els, scope);
    case "Ellipse":
      return decodeEllipse(els, scope);
    case "Text":
      return decodeText(els, scope);
    case "Bitmap":
      return decodeBitmap(els, scope);
    default:
      throw new Error(
        `decodeShape: unknown shape kind '${record.name}' (expected Line/Polygon/Rectangle/Ellipse/Text/Bitmap)`,
      );
  }
}

/**
 * Bridge a `getIconAnnotation`/`getDiagramAnnotation` graphic record (a
 * `parse.ts` {@link Value} tree) into the `modelInstance` {@link Expression}
 * the decoder consumes. Both wire formats carry graphics positionally in the
 * same field order; only the node encoding differs (e.g. an enum is an
 * `ident` here, an `{$kind:"enum"}` there).
 *
 * `null`/`kwarg` slots throw: OMC fills every positional field of a graphic
 * record with its default, so a sparse or named slot reaching here signals
 * input this was never pointed at — fail loud rather than write garbage.
 */
function annotationValueToExpression(v: Value): Expression {
  switch (v.kind) {
    case "int":
    case "float":
      return v.value;
    case "bool":
      return v.value;
    case "string":
      return v.value;
    case "ident": {
      // `index` is unread on the re-serialize path (the decoders take `name`);
      // OMC's positional records don't carry it, so 0 is a placeholder.
      const enumLit: EnumLiteral = { $kind: "enum", name: v.name, index: 0 };
      return enumLit;
    }
    case "list":
      return v.items.map(annotationValueToExpression);
    case "call": {
      const call: CallExpr = {
        $kind: "call",
        name: v.name,
        arguments: v.args.map(annotationValueToExpression),
      };
      return call;
    }
    case "kwarg":
      throw new Error(
        `annotationValueToExpression: unexpected named arg '${v.name}' in a graphic record`,
      );
    case "null":
      throw new Error(
        "annotationValueToExpression: unexpected null slot in a graphic record",
      );
  }
}

/**
 * Decode one graphic record from an `Icon`/`Diagram` annotation Value tree
 * into a typed {@link Shape}, reusing {@link decodeShape}. The write path
 * round-trips existing graphics through this so they re-serialize via the
 * same named-arg path new shapes take.
 */
export function decodeAnnotationShape(record: Value): Shape {
  if (record.kind !== "call") {
    throw new Error(
      `decodeAnnotationShape: expected a graphic record, got '${record.kind}'`,
    );
  }
  return decodeShape({
    $kind: "record",
    name: record.name,
    elements: record.args.map(annotationValueToExpression),
  });
}

export const _internal = {
  enumName,
  asPoint: (v: Expression | undefined): Point | undefined =>
    isPoint(v) ? [v[0], v[1]] : undefined,
  asPoints,
  asExtent,
  asColor,
  asNumber,
  asString,
  asEnumString,
  asArrow,
  asStringArray,
};
