/**
 * @modelica-wrapper/diagram-svg — public surface.
 *
 * Renders the typed `IconLayer[]` shape graphics emitted by the
 * `DiagramLayout` producer in `@modelica-wrapper/omc-client` into
 * self-contained SVG strings.
 *
 *   import { renderIconLayersToSvg } from "@modelica-wrapper/diagram-svg";
 *
 *   const svg = renderIconLayersToSvg(layout.iconLayers, {
 *     coordinateSystem: layout.coordinateSystem,
 *     background: "white",
 *   });
 *
 * The returned string is a complete `<svg>` document (with `viewBox`,
 * root y-flip transform, and one `<g class="diagram-svg-layer">` per
 * layer) — drop it into any HTML container or write it to disk verbatim.
 *
 * NOTE on types: this package consumes `IconLayer` / `Shape` / `ClassDef`
 * / `CoordinateSystem` from upstream. They are mirrored locally in
 * `./types.ts` because `omc-client` does not yet re-export them from its
 * package barrel; the local mirror is structurally compatible with the
 * producer's output. Once `omc-client/src/index.ts` re-exports them,
 * swap `./types.js` over to a `export type { ... } from "@modelica-wrapper/omc-client"`.
 */

export {
  renderIconLayersToSvg,
  renderClassIconToSvg,
  type RenderOptions,
} from "./render.js";

export type {
  BitmapShape,
  ClassDef,
  Color,
  CoordinateSystem,
  EllipseShape,
  Expression,
  Extent,
  IconLayer,
  LineShape,
  Point,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
} from "./types.js";

// Helper modules — exported so consumers can reuse the colour / pattern /
// expression mappers when building custom renderers (e.g. a Canvas
// fallback or a React wrapper).
export { colorToCss } from "./color.js";
export { fillPatternToFill, linePatternToDashArray } from "./pattern.js";
export { expressionToString } from "./expression.js";
