/**
 * Static schema of the spec-defined Modelica annotation vocabulary: a map from
 * each annotation record name to the field names it admits. The vocabulary is
 * fixed by the language/library spec, so it needs no OMC round-trip — completion
 * routes a nested record-name path (from {@link annotationPath}) through this map
 * and offers the resolved record's fields.
 *
 * No `vscode` import — plain data, unit-tested directly. The annotation source
 * maps the resolved field names onto candidates (see `sources/annotation.ts`).
 *
 * The top-level annotation vocabulary is keyed by {@link TOP_LEVEL}; an
 * `annotation(│)` caret (empty path) resolves to it. Coverage is the common
 * graphical/dialog/documentation records; an unknown record path resolves to
 * `undefined` and offers nothing.
 */

/** Schema key for the top-level annotation (the `annotation(│)` position). */
export const TOP_LEVEL = "";

/**
 * Record name → its admissible field names. Keyed by simple record name; the
 * same record (e.g. a graphic primitive) is valid under several parents, so the
 * map is flat by name rather than nested by path.
 */
const ANNOTATION_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  [TOP_LEVEL]: [
    "Placement",
    "Icon",
    "Diagram",
    "Documentation",
    "Evaluate",
    "Dialog",
    "choices",
    "experiment",
    "defaultComponentName",
    "defaultComponentPrefixes",
    "missingInnerMessage",
    "obsolete",
    "unassignedMessage",
    "Protection",
    "DynamicSelect",
    "preferredView",
    "version",
    "versionBuild",
    "dateModified",
    "revisionId",
    "uses",
    "HideResult",
  ],

  Placement: ["visible", "transformation", "iconTransformation"],
  transformation: ["origin", "extent", "rotation"],
  iconTransformation: ["origin", "extent", "rotation"],

  Icon: ["coordinateSystem", "graphics"],
  Diagram: ["coordinateSystem", "graphics"],
  coordinateSystem: ["extent", "preserveAspectRatio", "initialScale", "grid"],

  Line: [
    "visible",
    "points",
    "color",
    "pattern",
    "thickness",
    "arrow",
    "arrowSize",
    "smooth",
  ],
  Polygon: [
    "visible",
    "origin",
    "rotation",
    "lineColor",
    "fillColor",
    "pattern",
    "fillPattern",
    "lineThickness",
    "points",
    "smooth",
  ],
  Rectangle: [
    "visible",
    "origin",
    "rotation",
    "lineColor",
    "fillColor",
    "pattern",
    "fillPattern",
    "lineThickness",
    "borderPattern",
    "extent",
    "radius",
  ],
  Ellipse: [
    "visible",
    "origin",
    "rotation",
    "lineColor",
    "fillColor",
    "pattern",
    "fillPattern",
    "lineThickness",
    "extent",
    "startAngle",
    "endAngle",
    "closure",
  ],
  Text: [
    "visible",
    "origin",
    "rotation",
    "lineColor",
    "fillColor",
    "pattern",
    "fillPattern",
    "lineThickness",
    "extent",
    "textString",
    "fontSize",
    "fontName",
    "textColor",
    "horizontalAlignment",
    "textStyle",
    "string",
    "index",
  ],
  Bitmap: [
    "visible",
    "origin",
    "rotation",
    "extent",
    "fileName",
    "imageSource",
  ],

  Dialog: [
    "tab",
    "group",
    "enable",
    "showStartAttribute",
    "colorSelector",
    "loadSelector",
    "saveSelector",
    "groupImage",
    "connectorSizing",
  ],
  loadSelector: ["filter", "caption"],
  saveSelector: ["filter", "caption"],

  Documentation: ["info", "revisions"],

  choices: ["checkBox", "choice"],

  experiment: ["StartTime", "StopTime", "Interval", "Tolerance"],

  Evaluate: [],

  uses: ["version"],
};

/**
 * Field names valid for the annotation record at `path`. `[]` when the record
 * is unknown or admits no fields. `path` is the {@link annotationPath} chain:
 * `[]` resolves the
 * top-level annotation; the last segment names the record whose fields to offer.
 */
export function annotationFields(path: readonly string[]): readonly string[] {
  const record = path.at(-1) ?? TOP_LEVEL;
  return ANNOTATION_SCHEMA[record] ?? [];
}

/**
 * Field name → the fully-qualified enum members admissible as its value. Keyed
 * by simple field name (the same enum is valid wherever the field appears across
 * graphic records), so the map is flat. Each entry is a full `Enum.Member`
 * string, ready to insert as a valid value. The members are spec-fixed graphical
 * enums — purely static, no OMC.
 */
const FILL_PATTERN = [
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
const LINE_PATTERN = ["None", "Solid", "Dash", "Dot", "DashDot", "DashDotDot"];
const SMOOTH = ["None", "Bezier"];
const ARROW = ["None", "Open", "Filled", "Half"];
const TEXT_ALIGNMENT = ["Left", "Center", "Right"];
const TEXT_STYLE = ["Bold", "Italic", "UnderLine"];
const BORDER_PATTERN = ["None", "Raised", "Sunken", "Engraved"];

function qualified(enumName: string, members: readonly string[]): string[] {
  return members.map((member) => `${enumName}.${member}`);
}

const ANNOTATION_VALUE_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  fillPattern: qualified("FillPattern", FILL_PATTERN),
  pattern: qualified("LinePattern", LINE_PATTERN),
  linePattern: qualified("LinePattern", LINE_PATTERN),
  smooth: qualified("Smooth", SMOOTH),
  arrow: qualified("Arrow", ARROW),
  startArrow: qualified("Arrow", ARROW),
  endArrow: qualified("Arrow", ARROW),
  horizontalAlignment: qualified("TextAlignment", TEXT_ALIGNMENT),
  textStyle: qualified("TextStyle", TEXT_STYLE),
  borderPattern: qualified("BorderPattern", BORDER_PATTERN),
  visible: ["true", "false"],
  preserveAspectRatio: ["true", "false"],
};

/**
 * The fixed value candidates for the annotation `field` — its spec-defined
 * graphical enum members as full `Enum.Member` strings, or `["true", "false"]`
 * for a boolean field. `[]` for any field absent from the value schema, so
 * completion offers nothing rather than guessing.
 */
export function annotationFieldValues(field: string): readonly string[] {
  return ANNOTATION_VALUE_SCHEMA[field] ?? [];
}

/**
 * The simple names of the spec graphical enums that appear as annotation values
 * (`FillPattern`, `LinePattern`, `Smooth`, `Arrow`, …), derived from the
 * `Enum.Member` entries of {@link ANNOTATION_VALUE_SCHEMA}. Boolean fields
 * (`true`/`false`, no dot) contribute nothing. Consumers use it to recognise an
 * enum reference in value position (e.g. semantic highlighting).
 */
export const ANNOTATION_ENUM_NAMES: ReadonlySet<string> = new Set(
  Object.values(ANNOTATION_VALUE_SCHEMA).flatMap((values) =>
    values
      .filter((value) => value.includes("."))
      .map((value) => value.slice(0, value.indexOf("."))),
  ),
);
