/**
 * Static schema of the spec-defined Modelica annotation vocabulary: a map from
 * each annotation record name to the field names it admits. The vocabulary is
 * fixed by the language/library spec, so it needs no OMC round-trip — completion
 * routes a nested record-name path (from {@link annotationPath}) through this map
 * and offers the resolved record's fields.
 *
 * No `vscode` import — plain data, unit-tested directly. The provider maps the
 * resolved field names onto candidates (see `completion-provider.ts`).
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
 * Field names valid for the annotation record at `path`, or `[]` for an unknown
 * record. `path` is the {@link annotationPath} chain: `[]` resolves the
 * top-level annotation; the last segment names the record whose fields to offer.
 */
export function annotationFields(path: readonly string[]): readonly string[] {
  const record = path.at(-1) ?? TOP_LEVEL;
  return ANNOTATION_SCHEMA[record] ?? [];
}
