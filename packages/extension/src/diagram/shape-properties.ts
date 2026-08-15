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

import { assertUnreachable } from "@dicode/modelica-lang-core";

import type {
  BitmapShape,
  Color,
  DiagramLayout,
  EllipseShape,
  Expression,
  IconLayer,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
} from "@dicode/omc-client";
import type { ParameterField, ParameterModel } from "@dicode/omc-client";

import type { GraphicsLayer } from "./diff-layout.js";
import {
  BITMAP_DEFAULTS,
  defaultEllipseClosure,
  ELLIPSE_DEFAULTS,
  FILLED_SHAPE_DEFAULTS,
  GRAPHIC_ITEM_DEFAULTS,
  LINE_DEFAULTS,
  POLYGON_DEFAULTS,
  RECTANGLE_DEFAULTS,
  TEXT_DEFAULTS,
} from "@dicode/omc-client/shapes";

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

// ── Field codecs ──────────────────────────────────────────────────────────────

/**
 * How one shape property crosses the form boundary. A submitted value arrives
 * as `unknown` — one message envelope serves four form kinds whose fields
 * differ per model — so `decode` is the only place it stops being untyped.
 *
 * The guarantee is over the property's *type*, not its vocabulary: an
 * enumeration field is a `Codec<string>` like any other, so swapping
 * {@link enumCodec} for {@link stringCodec} on one is a free-text box, not a
 * compile error.
 */
interface Codec<T> {
  readonly kind: ParameterField["kind"];
  readonly enumChoices?: string[] | undefined;
  readonly enumTypeName?: string | undefined;
  readonly encode: (value: T) => ParameterField["value"];
  readonly decode: (raw: unknown) => T | undefined;
}

const numberCodec: Codec<number> = {
  kind: "number",
  encode: (value) => value,
  decode: (raw) => {
    if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  },
};

const booleanCodec: Codec<boolean> = {
  kind: "boolean",
  encode: (value) => value,
  decode: (raw) => {
    if (typeof raw === "boolean") return raw;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  },
};

const stringCodec: Codec<string> = {
  kind: "string",
  encode: (value) => value,
  decode: (raw) => (typeof raw === "string" ? raw : undefined),
};

const colorCodec: Codec<Color> = {
  kind: "color",
  encode: colorToHex,
  decode: (raw) =>
    typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)
      ? hexToColor(raw)
      : undefined,
};

/**
 * `textString` stays an `Expression` so a `DynamicSelect` call round-trips; the
 * form can only show and submit a literal, so anything else reads as blank and
 * is left alone on submit.
 */
const textStringCodec: Codec<NonNullable<Expression>> = {
  kind: "string",
  encode: (value) => (typeof value === "string" ? value : null),
  decode: (raw) => (typeof raw === "string" ? raw : undefined),
};

function enumCodec(enumTypeName: string, enumChoices: string[]): Codec<string> {
  return {
    kind: "enum",
    enumChoices,
    enumTypeName,
    encode: (value) => value,
    decode: (raw) => (typeof raw === "string" && raw !== "" ? raw : undefined),
  };
}

// ── Field declarations ────────────────────────────────────────────────────────

/**
 * One editable shape property. The same entry seeds the form widget and writes
 * the submitted value back, so a name only one half knows is a compile error
 * rather than a field the modal renders and Apply silently drops.
 *
 * Both members are property-typed rather than methods. This is half of what
 * keeps a field out of the wrong kind's list — see {@link FilledShapeKind} for
 * the other half, which does not work without this one: method syntax is
 * checked bivariantly, so a `ShapeField<PolygonShape>` would stay assignable to
 * `ShapeField<LineShape>` however the groups are declared.
 */
interface ShapeField<S> {
  readonly name: string;
  readonly toParameterField: (shape: S) => ParameterField;
  /**
   * `updated` with `raw` applied, or `updated` itself when `raw` does not
   * decode. `opened` is the shape the form was built from, which a derived
   * fallback resolves against.
   */
  readonly write: <T extends S>(opened: T, updated: T, raw: unknown) => T;
}

/**
 * Declare one field of a shape of type `S`. Curried so `S` is named by the
 * caller while the property key stays inferred from `name`, which is what makes
 * a `codec` that does not match the property's type a compile error.
 */
function fieldOf<S extends object>() {
  return function declare<K extends keyof S & string>(
    spec: {
      name: K;
      label: string;
      group: string;
      codec: Codec<NonNullable<S[K]>>;
    } & (
      | {
          /** The Modelica default (spec §18.6), reported as the field's reset target. */
          fallback: NonNullable<S[K]>;
          fallbackFrom?: undefined;
        }
      | {
          fallback?: undefined;
          /**
           * For a §18.6 default the spec derives from other fields of the same
           * shape, so the reset target differs per shape being edited.
           */
          fallbackFrom: (shape: S) => NonNullable<S[K]>;
        }
    ),
  ): ShapeField<S> {
    const { name, label, group, codec } = spec;
    const fallbackFor = (shape: S): NonNullable<S[K]> =>
      spec.fallbackFrom === undefined
        ? spec.fallback
        : spec.fallbackFrom(shape);
    // A color picker has no empty state, so seeding a shape's absent color
    // with the default would write a color the source never set on Apply.
    const seedsFallback = codec.kind !== "color";
    return {
      name,
      toParameterField(shape) {
        const current = shape[name];
        const fallback = fallbackFor(shape);
        return {
          name,
          label,
          kind: codec.kind,
          // `null` is a real, reachable value distinct from "unset" — OMC
          // reports it for a `textString` it can't reduce to a literal — so
          // it must not fall through to the fallback the way `undefined`
          // does, or Apply resubmits the fallback and overwrites it.
          value:
            current === null
              ? null
              : current !== undefined || seedsFallback
                ? codec.encode(current ?? fallback)
                : null,
          defaultValue: codec.encode(fallback),
          enumChoices: codec.enumChoices,
          enumTypeName: codec.enumTypeName,
          dialog: { tab: "Properties", group },
          unitOptions: [],
        };
      },
      write(opened, updated, raw) {
        const decoded = codec.decode(raw);
        if (decoded === undefined) return updated;
        // The form submits every field, so a derived fallback returns
        // untouched and indistinguishable from a choice. Writing it pins a
        // derivation the same submit may have invalidated — changing an
        // ellipse's angles would fix its closure to the one the old angles
        // implied. Left unset, §18.6 re-derives it from the new angles.
        const derived = spec.fallbackFrom;
        if (
          derived !== undefined &&
          opened[name] === undefined &&
          codec.encode(decoded) === codec.encode(derived(opened))
        ) {
          return updated;
        }
        return { ...updated, [name]: decoded };
      },
    };
  };
}

/**
 * The shared groups are declared over the shape kinds that carry them, not over
 * the `GraphicItem` / `FilledShape` records. Both records are all-optional, so
 * every shape is structurally assignable to them and declaring against one
 * would let a filled-shape field into a `Line`'s list and write `lineColor`
 * onto a Modelica `Line`.
 *
 * This is the other half of the pair described on {@link ShapeField}. Undoing
 * either half reopens the hole with every gate still green.
 */
type FilledShapeKind = PolygonShape | RectangleShape | EllipseShape;

const graphicItemField = fieldOf<Shape>();
const filledShapeField = fieldOf<FilledShapeKind>();
const lineField = fieldOf<LineShape>();
const polygonField = fieldOf<PolygonShape>();
const rectangleField = fieldOf<RectangleShape>();
const ellipseField = fieldOf<EllipseShape>();
const textField = fieldOf<TextShape>();
const bitmapField = fieldOf<BitmapShape>();

const GRAPHIC_ITEM_FIELDS: ShapeField<Shape>[] = [
  graphicItemField({
    name: "visible",
    label: "Visible",
    group: "General",
    codec: booleanCodec,
    fallback: GRAPHIC_ITEM_DEFAULTS.visible,
  }),
  graphicItemField({
    name: "rotation",
    label: "Rotation (°)",
    group: "General",
    codec: numberCodec,
    fallback: GRAPHIC_ITEM_DEFAULTS.rotation,
  }),
];

const FILLED_SHAPE_FIELDS: ShapeField<FilledShapeKind>[] = [
  filledShapeField({
    name: "lineColor",
    label: "Line Color",
    group: "Style",
    codec: colorCodec,
    fallback: FILLED_SHAPE_DEFAULTS.lineColor,
  }),
  filledShapeField({
    name: "fillColor",
    label: "Fill Color",
    group: "Style",
    codec: colorCodec,
    fallback: FILLED_SHAPE_DEFAULTS.fillColor,
  }),
  filledShapeField({
    name: "pattern",
    label: "Line Pattern",
    group: "Style",
    codec: enumCodec("LinePattern", LINE_PATTERNS),
    fallback: FILLED_SHAPE_DEFAULTS.pattern,
  }),
  filledShapeField({
    name: "fillPattern",
    label: "Fill Pattern",
    group: "Style",
    codec: enumCodec("FillPattern", FILL_PATTERNS),
    fallback: FILLED_SHAPE_DEFAULTS.fillPattern,
  }),
  filledShapeField({
    name: "lineThickness",
    label: "Line Thickness",
    group: "Style",
    codec: numberCodec,
    fallback: FILLED_SHAPE_DEFAULTS.lineThickness,
  }),
];

const LINE_FIELDS: ShapeField<LineShape>[] = [
  ...GRAPHIC_ITEM_FIELDS,
  lineField({
    name: "color",
    label: "Color",
    group: "Style",
    codec: colorCodec,
    fallback: LINE_DEFAULTS.color,
  }),
  lineField({
    name: "thickness",
    label: "Thickness",
    group: "Style",
    codec: numberCodec,
    fallback: LINE_DEFAULTS.thickness,
  }),
  lineField({
    name: "pattern",
    label: "Line Pattern",
    group: "Style",
    codec: enumCodec("LinePattern", LINE_PATTERNS),
    fallback: LINE_DEFAULTS.pattern,
  }),
  lineField({
    name: "smooth",
    label: "Smooth",
    group: "Style",
    codec: enumCodec("Smooth", SMOOTH_VALUES),
    fallback: LINE_DEFAULTS.smooth,
  }),
  lineField({
    name: "arrowSize",
    label: "Arrow Size",
    group: "Style",
    codec: numberCodec,
    fallback: LINE_DEFAULTS.arrowSize,
  }),
];

const POLYGON_FIELDS: ShapeField<PolygonShape>[] = [
  ...GRAPHIC_ITEM_FIELDS,
  ...FILLED_SHAPE_FIELDS,
  polygonField({
    name: "smooth",
    label: "Smooth",
    group: "Style",
    codec: enumCodec("Smooth", SMOOTH_VALUES),
    fallback: POLYGON_DEFAULTS.smooth,
  }),
];

const RECTANGLE_FIELDS: ShapeField<RectangleShape>[] = [
  ...GRAPHIC_ITEM_FIELDS,
  ...FILLED_SHAPE_FIELDS,
  rectangleField({
    name: "borderPattern",
    label: "Border Pattern",
    group: "Style",
    codec: enumCodec("BorderPattern", BORDER_PATTERNS),
    fallback: RECTANGLE_DEFAULTS.borderPattern,
  }),
  rectangleField({
    name: "radius",
    label: "Radius",
    group: "Style",
    codec: numberCodec,
    fallback: RECTANGLE_DEFAULTS.radius,
  }),
];

const ELLIPSE_FIELDS: ShapeField<EllipseShape>[] = [
  ...GRAPHIC_ITEM_FIELDS,
  ...FILLED_SHAPE_FIELDS,
  ellipseField({
    name: "startAngle",
    label: "Start Angle (°)",
    group: "Arc",
    codec: numberCodec,
    fallback: ELLIPSE_DEFAULTS.startAngle,
  }),
  ellipseField({
    name: "endAngle",
    label: "End Angle (°)",
    group: "Arc",
    codec: numberCodec,
    fallback: ELLIPSE_DEFAULTS.endAngle,
  }),
  ellipseField({
    name: "closure",
    label: "Closure",
    group: "Arc",
    codec: enumCodec("EllipseClosure", ELLIPSE_CLOSURES),
    fallbackFrom: defaultEllipseClosure,
  }),
];

const TEXT_FIELDS: ShapeField<TextShape>[] = [
  ...GRAPHIC_ITEM_FIELDS,
  textField({
    name: "textString",
    label: "Text",
    group: "Text",
    codec: textStringCodec,
    fallback: TEXT_DEFAULTS.textString,
  }),
  textField({
    name: "fontName",
    label: "Font Name",
    group: "Text",
    codec: stringCodec,
    fallback: TEXT_DEFAULTS.fontName,
  }),
  textField({
    name: "fontSize",
    label: "Font Size",
    group: "Text",
    codec: numberCodec,
    fallback: TEXT_DEFAULTS.fontSize,
  }),
  textField({
    name: "textColor",
    label: "Text Color",
    group: "Text",
    codec: colorCodec,
    fallback: TEXT_DEFAULTS.textColor,
  }),
  textField({
    name: "horizontalAlignment",
    label: "Horizontal Alignment",
    group: "Text",
    codec: enumCodec("TextAlignment", TEXT_ALIGNMENTS),
    fallback: TEXT_DEFAULTS.horizontalAlignment,
  }),
];

const BITMAP_FIELDS: ShapeField<BitmapShape>[] = [
  ...GRAPHIC_ITEM_FIELDS,
  bitmapField({
    name: "fileName",
    label: "File Name",
    group: "Image",
    codec: stringCodec,
    fallback: BITMAP_DEFAULTS.fileName,
  }),
];

// ── Kind dispatch ─────────────────────────────────────────────────────────────

const SHAPE_LABEL: Record<Shape["kind"], string> = {
  line: "Line",
  polygon: "Polygon",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  bitmap: "Bitmap",
};

/** Run `use` with `shape` narrowed to its kind and that kind's field list. */
function withFields<R>(
  shape: Shape,
  use: <S extends Shape>(shape: S, fields: ShapeField<S>[]) => R,
): R {
  switch (shape.kind) {
    case "line":
      return use(shape, LINE_FIELDS);
    case "polygon":
      return use(shape, POLYGON_FIELDS);
    case "rectangle":
      return use(shape, RECTANGLE_FIELDS);
    case "ellipse":
      return use(shape, ELLIPSE_FIELDS);
    case "text":
      return use(shape, TEXT_FIELDS);
    case "bitmap":
      return use(shape, BITMAP_FIELDS);
    default:
      return assertUnreachable(shape, "Shape kind");
  }
}

// ── Form builder and value applier ────────────────────────────────────────────

/**
 * Build a `ParameterModel` for the given shape so the standard parameter-form
 * webview can render it as an annotation-property editor.
 */
export function buildShapePropertiesForm(shape: Shape): ParameterModel {
  return {
    className: SHAPE_LABEL[shape.kind],
    fields: withFields(shape, (narrowed, fields) =>
      fields.map((field) => field.toParameterField(narrowed)),
    ),
  };
}

/**
 * Merge submitted form `values` into a copy of `shape`. Only fields that
 * decode cleanly are written; absent or malformed values leave the
 * corresponding shape property unchanged.
 */
export function applyShapeProperties(
  shape: Shape,
  values: Record<string, unknown>,
): Shape {
  return withFields(shape, (narrowed, fields) =>
    // `write` is the identity when nothing decodes, so the seed has to be the
    // copy. Every field resolves against `narrowed` rather than the
    // accumulator, so an earlier field's new value cannot shift what a later
    // one treats as its untouched seed.
    fields.reduce(
      (updated, field) => field.write(narrowed, updated, values[field.name]),
      { ...narrowed },
    ),
  );
}
