/**
 * @modelica-wrapper/diagram-ui
 *
 * Lit + Babylon.js custom elements (`<om-*>`) that render a Modelica
 * graphical layout inside the VSCode webview.
 *
 * Inputs:
 *   - `DiagramLayout` from `@modelica-wrapper/omc-client` (the producer
 *     output over `getModelInstance` JSON).
 *   - SVG icon strings from `@modelica-wrapper/diagram-svg`, rasterised
 *     into Babylon `Texture`s by the icon-provider (added in stage C).
 *
 * Composition:
 *   `<om-scene>` creates the Babylon engine and provides a parentNodeCtx
 *   (`TransformNode`). Each entity element (`<om-component>`,
 *   `<om-connector>`, `<om-edge>`, `<om-label>`, ...) is a thin
 *   Lit→Babylon bridge that consumes its parent node, creates one
 *   `TransformNode`, syncs Lit properties to Babylon state, and provides
 *   itself as the parent context to its own children.
 */

export const PACKAGE_NAME = "@modelica-wrapper/diagram-ui";

export { OmScene, type EngineFactory } from "./scene/scene.component.js";
export { sceneContext, type SceneContext } from "./scene/scene-context.js";
export { parentNodeContext } from "./base/parent-node-context.js";
export {
  PanZoom,
  DEFAULT_PAN_ZOOM_BOUNDS,
  DEFAULT_ZOOM_STEP,
  type PanZoomBounds,
  type PanZoomOptions,
} from "./scene/pan-zoom.js";
export {
  clientToDiagram,
  diagramToClient,
  applyPanDelta,
  applyZoomAroundCursor,
  type ViewState,
  type CanvasSize,
  type DiagramPoint,
} from "./scene/view-math.js";
export { OmGridAxis } from "./axis/grid-axis.component.js";
export {
  buildGrid,
  DEFAULT_GRID_OPTIONS,
  type GridOptions,
  type GridMeshes,
} from "./axis/grid-build.js";
export { OmComponent } from "./component/component.component.js";
export { OmConnector } from "./connector/connector.component.js";
export { OmEdge } from "./connection/edge.component.js";
export {
  buildEdge,
  DEFAULT_EDGE_WIDTH,
  DEFAULT_EDGE_COLOR,
  EDGE_Z_OFFSET,
  type EdgeOptions,
} from "./connection/edge-build.js";
export { OmShapeElement } from "./base/shape-element.js";
export { OmShapeNode } from "./base/shape-node.js";
export {
  applyPlacement,
  coordSystemSize,
  defaultCoordSystemSize,
  type AppliedTransform,
} from "./base/placement-math.js";
export { OmIconProvider } from "./icon-provider/icon-provider.component.js";
export {
  IconCache,
  type IconRequest,
  type SvgRenderFn,
  type RasterizeFn,
} from "./icon-provider/icon-cache.js";
export {
  iconProviderContext,
  type IconProviderContext,
} from "./icon-provider/icon-provider-context.js";
export { rasterizeSvgToTexture } from "./icon-provider/svg-rasterizer.js";
