/**
 * Shape annotation form builder and value applier for the shape properties
 * panel.
 *
 * `buildShapePropertiesForm` maps a typed `Shape` to a `ParameterModel` the
 * standard parameter-form webview can render. `applyShapeProperties` inverts
 * it: submitted form values are mapped back onto the shape, ready for the
 * `graphicsModified` edit path.
 *
 * Color representation across the boundary:
 *   Shape side  — `Color = [r, g, b]`  (0-255 integers)
 *   Form side   — `"#rrggbb"` hex string  (native `<input type="color">`)
 * `colorToHex` / `hexToColor` are the two conversion helpers.
 */

import type {
  BitmapShape,
  Color,
  DiagramLayout,
  EllipseShape,
  IconLayer,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
} from "@dicode/omc-client";
import type { ParameterField, ParameterModel } from "@dicode/omc-client";

import type { GraphicsLayer } from "./diff-layout.js";

// ── Color helpers ─────────────────────────────────────────────────────────────

export function colorToHex([r, g, b]: Color): string {
  return (
    "#" +
    [r, g, b]
      .map((n) =>
        Math.round(Math.max(0, Math.min(255, n)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function hexToColor(hex: string): Color {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [
    Number.isNaN(r) ? 0 : r,
    Number.isNaN(g) ? 0 : g,
    Number.isNaN(b) ? 0 : b,
  ];
}

// ── Shape lookup ─────────────────────────────────────────────────────────────

export function findHostLayer(
  layers: IconLayer[],
  className: string,
): IconLayer | undefined {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer !== undefined && layer.from === className) return layer;
  }
  return undefined;
}

/**
 * Find the shape at `index` in the host class's own annotation layer.
 * Checks `diagramLayers` first (preferred for diagram-mode panels), then
 * `iconLayers`. Returns `null` when the index is out of range or the host
 * has no own shapes in either layer.
 *
 * `shapeKind`, when supplied, must match the shape's own kind — the caller
 * re-resolves against a freshly-fetched layout, so an undo/edit that shifted
 * indices between selection and submit would otherwise route the write onto
 * whatever shape now sits at that index. Mismatches yield `null`.
 */
export function lookupHostShape(
  layout: DiagramLayout,
  index: number,
  shapeKind?: string,
): { shape: Shape; layerKind: GraphicsLayer } | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const matches = (shape: Shape): boolean =>
    shapeKind === undefined || shape.kind === shapeKind;
  const diagLayer = findHostLayer(layout.diagramLayers, layout.className);
  if (diagLayer !== undefined) {
    const shape = diagLayer.shapes[index];
    if (shape !== undefined && matches(shape)) {
      return { shape, layerKind: "diagram" };
    }
  }
  const iconLayer = findHostLayer(layout.iconLayers, layout.className);
  if (iconLayer !== undefined) {
    const shape = iconLayer.shapes[index];
    if (shape !== undefined && matches(shape)) {
      return { shape, layerKind: "icon" };
    }
  }
  return null;
}

// ── Enum vocabularies ─────────────────────────────────────────────────────────

const LINE_PATTERNS = ["None", "Solid", "Dash", "Dot", "DashDot", "DashDotDot"];
const FILL_PATTERNS = [
  "None",
  "Solid",
  "Horizontal",
  "Vertical",
  "Cross",
  "Forward",
  "Backward",
  "CrossDiag",
  "HorizontalCylinder",
  "VerticalCylinder",
  "Sphere",
];
const SMOOTH_VALUES = ["None", "Bezier"];
const BORDER_PATTERNS = ["None", "Raised", "Sunken", "Engraved"];
const ELLIPSE_CLOSURES = ["None", "Chord", "Radial"];
const TEXT_ALIGNMENTS = ["Left", "Center", "Right"];

// ── Field construction ────────────────────────────────────────────────────────

type FieldInit = {
  name: string;
  label: string;
  kind: ParameterField["kind"];
  value: ParameterField["value"];
  defaultValue?: ParameterField["defaultValue"];
  enumChoices?: string[];
  enumTypeName?: string;
  group: string;
};

function f({
  name,
  label,
  kind,
  value,
  defaultValue,
  enumChoices,
  enumTypeName,
  group,
}: FieldInit): ParameterField {
  return {
    name,
    label,
    kind,
    value: value ?? null,
    defaultValue,
    enumChoices,
    enumTypeName,
    dialog: { tab: "Properties", group },
    unitOptions: [],
  };
}

function graphicItemFields(s: Shape): FieldInit[] {
  return [
    {
      name: "visible",
      label: "Visible",
      kind: "boolean",
      value: s.visible ?? true,
      defaultValue: true,
      group: "General",
    },
    {
      name: "rotation",
      label: "Rotation (°)",
      kind: "number",
      value: s.rotation ?? 0,
      defaultValue: 0,
      group: "General",
    },
  ];
}

function lineFields(s: LineShape): FieldInit[] {
  return [
    ...graphicItemFields(s),
    {
      name: "color",
      label: "Color",
      kind: "color",
      value: s.color !== undefined ? colorToHex(s.color) : null,
      defaultValue: colorToHex([0, 0, 0]),
      group: "Style",
    },
    {
      name: "thickness",
      label: "Thickness",
      kind: "number",
      value: s.thickness ?? 0.25,
      defaultValue: 0.25,
      group: "Style",
    },
    {
      name: "pattern",
      label: "Line Pattern",
      kind: "enum",
      value: s.pattern ?? "Solid",
      defaultValue: "Solid",
      enumChoices: LINE_PATTERNS,
      enumTypeName: "LinePattern",
      group: "Style",
    },
    {
      name: "smooth",
      label: "Smooth",
      kind: "enum",
      value: s.smooth ?? "None",
      defaultValue: "None",
      enumChoices: SMOOTH_VALUES,
      enumTypeName: "Smooth",
      group: "Style",
    },
    {
      name: "arrowSize",
      label: "Arrow Size",
      kind: "number",
      value: s.arrowSize ?? 3,
      defaultValue: 3,
      group: "Style",
    },
  ];
}

function filledShapeFields(s: {
  lineColor?: Color | undefined;
  fillColor?: Color | undefined;
  pattern?: string | undefined;
  fillPattern?: string | undefined;
  lineThickness?: number | undefined;
}): FieldInit[] {
  return [
    {
      name: "lineColor",
      label: "Line Color",
      kind: "color",
      value: s.lineColor !== undefined ? colorToHex(s.lineColor) : null,
      defaultValue: colorToHex([0, 0, 0]),
      group: "Style",
    },
    {
      name: "fillColor",
      label: "Fill Color",
      kind: "color",
      value: s.fillColor !== undefined ? colorToHex(s.fillColor) : null,
      defaultValue: colorToHex([0, 0, 255]),
      group: "Style",
    },
    {
      name: "pattern",
      label: "Line Pattern",
      kind: "enum",
      value: s.pattern ?? "Solid",
      defaultValue: "Solid",
      enumChoices: LINE_PATTERNS,
      enumTypeName: "LinePattern",
      group: "Style",
    },
    {
      name: "fillPattern",
      label: "Fill Pattern",
      kind: "enum",
      value: s.fillPattern ?? "None",
      defaultValue: "None",
      enumChoices: FILL_PATTERNS,
      enumTypeName: "FillPattern",
      group: "Style",
    },
    {
      name: "lineThickness",
      label: "Line Thickness",
      kind: "number",
      value: s.lineThickness ?? 0.25,
      defaultValue: 0.25,
      group: "Style",
    },
  ];
}

function polygonFields(s: PolygonShape): FieldInit[] {
  return [
    ...graphicItemFields(s),
    ...filledShapeFields(s),
    {
      name: "smooth",
      label: "Smooth",
      kind: "enum",
      value: s.smooth ?? "None",
      defaultValue: "None",
      enumChoices: SMOOTH_VALUES,
      enumTypeName: "Smooth",
      group: "Style",
    },
  ];
}

function rectangleFields(s: RectangleShape): FieldInit[] {
  return [
    ...graphicItemFields(s),
    ...filledShapeFields(s),
    {
      name: "borderPattern",
      label: "Border Pattern",
      kind: "enum",
      value: s.borderPattern ?? "None",
      defaultValue: "None",
      enumChoices: BORDER_PATTERNS,
      enumTypeName: "BorderPattern",
      group: "Style",
    },
    {
      name: "radius",
      label: "Radius",
      kind: "number",
      value: s.radius ?? 0,
      defaultValue: 0,
      group: "Style",
    },
  ];
}

function ellipseFields(s: EllipseShape): FieldInit[] {
  return [
    ...graphicItemFields(s),
    ...filledShapeFields(s),
    {
      name: "startAngle",
      label: "Start Angle (°)",
      kind: "number",
      value: s.startAngle ?? 0,
      defaultValue: 0,
      group: "Arc",
    },
    {
      name: "endAngle",
      label: "End Angle (°)",
      kind: "number",
      value: s.endAngle ?? 360,
      defaultValue: 360,
      group: "Arc",
    },
    {
      name: "closure",
      label: "Closure",
      kind: "enum",
      value: s.closure ?? "None",
      defaultValue: "None",
      enumChoices: ELLIPSE_CLOSURES,
      enumTypeName: "EllipseClosure",
      group: "Arc",
    },
  ];
}

function textFields(s: TextShape): FieldInit[] {
  const textStringValue =
    typeof s.textString === "string" ? s.textString : null;
  return [
    ...graphicItemFields(s),
    {
      name: "textString",
      label: "Text",
      kind: "string",
      value: textStringValue,
      defaultValue: "",
      group: "Text",
    },
    {
      name: "fontName",
      label: "Font Name",
      kind: "string",
      value: s.fontName ?? "",
      defaultValue: "",
      group: "Text",
    },
    {
      name: "fontSize",
      label: "Font Size",
      kind: "number",
      value: s.fontSize ?? 0,
      defaultValue: 0,
      group: "Text",
    },
    {
      name: "textColor",
      label: "Text Color",
      kind: "color",
      value: s.textColor !== undefined ? colorToHex(s.textColor) : null,
      defaultValue: colorToHex([0, 0, 0]),
      group: "Text",
    },
    {
      name: "horizontalAlignment",
      label: "Horizontal Alignment",
      kind: "enum",
      value: s.horizontalAlignment ?? "Center",
      defaultValue: "Center",
      enumChoices: TEXT_ALIGNMENTS,
      enumTypeName: "TextAlignment",
      group: "Text",
    },
  ];
}

function bitmapFields(s: BitmapShape): FieldInit[] {
  return [
    ...graphicItemFields(s),
    {
      name: "fileName",
      label: "File Name",
      kind: "string",
      value: s.fileName ?? "",
      defaultValue: "",
      group: "Image",
    },
  ];
}

// ── Form builder ──────────────────────────────────────────────────────────────

const SHAPE_LABEL: Record<Shape["kind"], string> = {
  line: "Line",
  polygon: "Polygon",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  bitmap: "Bitmap",
};

/**
 * Build a `ParameterModel` for the given shape so the standard parameter-form
 * webview can render it as an annotation-property editor.
 */
export function buildShapePropertiesForm(shape: Shape): ParameterModel {
  const fieldInits: FieldInit[] = ((): FieldInit[] => {
    switch (shape.kind) {
      case "line":
        return lineFields(shape);
      case "polygon":
        return polygonFields(shape);
      case "rectangle":
        return rectangleFields(shape);
      case "ellipse":
        return ellipseFields(shape);
      case "text":
        return textFields(shape);
      case "bitmap":
        return bitmapFields(shape);
    }
  })();

  return {
    className: SHAPE_LABEL[shape.kind],
    fields: fieldInits.map(f),
  };
}

// ── Value applier ─────────────────────────────────────────────────────────────

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function toBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function toHexColor(v: unknown): Color | undefined {
  if (typeof v !== "string") return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return undefined;
  return hexToColor(v);
}

function toEnumString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function applyGraphicItem<T extends Shape>(
  shape: T,
  values: Record<string, unknown>,
): T {
  const visible = toBoolean(values["visible"]);
  const rotation = toNumber(values["rotation"]);
  return {
    ...shape,
    ...(visible !== undefined ? { visible } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
  };
}

function applyLine(s: LineShape, values: Record<string, unknown>): LineShape {
  const color = toHexColor(values["color"]);
  const thickness = toNumber(values["thickness"]);
  const pattern = toEnumString(values["pattern"]);
  const smooth = toEnumString(values["smooth"]);
  const arrowSize = toNumber(values["arrowSize"]);
  return {
    ...applyGraphicItem(s, values),
    ...(color !== undefined ? { color } : {}),
    ...(thickness !== undefined ? { thickness } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(smooth !== undefined ? { smooth } : {}),
    ...(arrowSize !== undefined ? { arrowSize } : {}),
  };
}

function applyFilledShape<
  T extends {
    lineColor?: Color | undefined;
    fillColor?: Color | undefined;
    pattern?: string | undefined;
    fillPattern?: string | undefined;
    lineThickness?: number | undefined;
  },
>(s: T, values: Record<string, unknown>): T {
  const lineColor = toHexColor(values["lineColor"]);
  const fillColor = toHexColor(values["fillColor"]);
  const pattern = toEnumString(values["pattern"]);
  const fillPattern = toEnumString(values["fillPattern"]);
  const lineThickness = toNumber(values["lineThickness"]);
  return {
    ...s,
    ...(lineColor !== undefined ? { lineColor } : {}),
    ...(fillColor !== undefined ? { fillColor } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(fillPattern !== undefined ? { fillPattern } : {}),
    ...(lineThickness !== undefined ? { lineThickness } : {}),
  };
}

function applyPolygon(
  s: PolygonShape,
  values: Record<string, unknown>,
): PolygonShape {
  const smooth = toEnumString(values["smooth"]);
  return {
    ...applyFilledShape(applyGraphicItem(s, values), values),
    ...(smooth !== undefined ? { smooth } : {}),
  };
}

function applyRectangle(
  s: RectangleShape,
  values: Record<string, unknown>,
): RectangleShape {
  const borderPattern = toEnumString(values["borderPattern"]);
  const radius = toNumber(values["radius"]);
  return {
    ...applyFilledShape(applyGraphicItem(s, values), values),
    ...(borderPattern !== undefined ? { borderPattern } : {}),
    ...(radius !== undefined ? { radius } : {}),
  };
}

function applyEllipse(
  s: EllipseShape,
  values: Record<string, unknown>,
): EllipseShape {
  const startAngle = toNumber(values["startAngle"]);
  const endAngle = toNumber(values["endAngle"]);
  const closure = toEnumString(values["closure"]);
  return {
    ...applyFilledShape(applyGraphicItem(s, values), values),
    ...(startAngle !== undefined ? { startAngle } : {}),
    ...(endAngle !== undefined ? { endAngle } : {}),
    ...(closure !== undefined ? { closure } : {}),
  };
}

function applyText(s: TextShape, values: Record<string, unknown>): TextShape {
  const textString =
    typeof values["textString"] === "string" ? values["textString"] : undefined;
  const fontName =
    typeof values["fontName"] === "string" ? values["fontName"] : undefined;
  const fontSize = toNumber(values["fontSize"]);
  const textColor = toHexColor(values["textColor"]);
  const horizontalAlignment = toEnumString(values["horizontalAlignment"]);
  return {
    ...applyGraphicItem(s, values),
    ...(textString !== undefined ? { textString } : {}),
    ...(fontName !== undefined ? { fontName } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(textColor !== undefined ? { textColor } : {}),
    ...(horizontalAlignment !== undefined ? { horizontalAlignment } : {}),
  };
}

function applyBitmap(
  s: BitmapShape,
  values: Record<string, unknown>,
): BitmapShape {
  const fileName =
    typeof values["fileName"] === "string" ? values["fileName"] : undefined;
  return {
    ...applyGraphicItem(s, values),
    ...(fileName !== undefined ? { fileName } : {}),
  };
}

/**
 * Merge submitted form `values` into a copy of `shape`. Only fields that
 * parse cleanly are written; absent or malformed values leave the
 * corresponding shape property unchanged.
 */
export function applyShapeProperties(
  shape: Shape,
  values: Record<string, unknown>,
): Shape {
  switch (shape.kind) {
    case "line":
      return applyLine(shape, values);
    case "polygon":
      return applyPolygon(shape, values);
    case "rectangle":
      return applyRectangle(shape, values);
    case "ellipse":
      return applyEllipse(shape, values);
    case "text":
      return applyText(shape, values);
    case "bitmap":
      return applyBitmap(shape, values);
  }
}
