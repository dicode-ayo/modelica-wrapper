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
export { OmMultibodyRoot } from "./multibody/multibody-root.component.js";
export {
  buildGrid,
  DEFAULT_GRID_OPTIONS,
  GRID_Z,
  type GridOptions,
  type GridMeshes,
} from "./axis/grid-build.js";
export { OmGraphicalLayout } from "./graphical-layout/graphical-layout.component.js";
export type {
  LayoutEvents,
  LayoutEventName,
  LayoutEvent,
  LayoutChangeDetail,
  SelectionChangeDetail,
  DoubleClickDetail,
  ContextMenuDetail,
  ConnectionCreateDetail,
  AddComponentRequestDetail,
  ResizeDetail,
} from "./graphical-layout/layout-events.js";
export { OmComponent } from "./component/component.component.js";
export { OmConnector } from "./connector/connector.component.js";
export { OmEdge } from "./connection/edge.component.js";
export { OmConnection } from "./connection/connection.component.js";
export { OmLabel } from "./label/label.component.js";
export { ensureLabelTexture } from "./label/label-texture.js";
export {
  InteractionManager,
  defaultPicker,
  type PickerFn,
  type EmitFn,
  type InteractionEvents,
  type InteractionManagerOptions,
} from "./interaction/interaction-manager.js";
export {
  entityKeyForNode,
  formatKey,
  formatComponentKey,
  formatConnectorKey,
  parseKey,
  isComponentKey,
  isConnectorKey,
  isEdgeKey,
  isJunctionKey,
  isLabelKey,
  isPortKey,
  isHandleKey,
  isNestedConnector,
  type EntityKind,
  type EntityKey,
  type ComponentKey,
  type ConnectorKey,
  type EdgeKey,
  type JunctionKey,
  type LabelKey,
  type PortKey,
  type HandleKey,
} from "./interaction/node-keys.js";
export {
  applyDeltaMove,
  applyComponentExtent,
  applyConnectorExtent,
  applyDelete,
  applyRotate,
  applyFlip,
  normaliseRect,
  selectByDiagramRect,
  type DiagramRect,
} from "./interaction/layout-ops.js";
export {
  DragController,
  type Picker as DragPicker,
  type ClientToDiagram,
  type DragEvents,
  type DragEmit,
  type SelectionProvider,
} from "./interaction/drag-controller.js";
export {
  buildEdge,
  DEFAULT_EDGE_COLOR,
  EDGE_Z_OFFSET,
  type EdgeOptions,
} from "./connection/edge-build.js";
export { OmShapeElement } from "./base/shape-element.js";
export { OmShapeNode } from "./base/shape-node.js";
export { OmIconOverlay } from "./base/icon-overlay.component.js";
export {
  ResizeHandles,
  setMeshHighlight,
} from "./base/selection-overlay.js";
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
export {
  rasterizeSvgToTexture,
  setRasterizerDebug,
} from "./icon-provider/svg-rasterizer.js";
export { OmDebugPlane } from "./debug/debug-plane.component.js";
export { OmPerfHud } from "./debug/perf-hud.component.js";
export {
  OmActionPanel,
  type ActionPanelAnchor,
  type ActionPanelEvents,
  type ActionPanelEventName,
  type ActionUndoDetail,
  type ActionCheckDetail,
  type ActionSimulateDetail,
  type ActionParametersDetail,
} from "./action-panel/action-panel.component.js";
export {
  OmParameterForm,
  type ParameterFormChangeDetail,
  type ParameterFormSubmitDetail,
} from "./parameter-form/parameter-form.component.js";
export { OmParameterPanel } from "./parameter-form/parameter-panel.component.js";
export {
  OmLibraryBrowser,
  type LibraryBrowserDataSource,
  type LibraryClassInfo,
  type LibraryClassRestriction,
  type LibraryEvents,
  type LibrarySelectDetail,
  type LibraryCancelDetail,
} from "./library-browser/library-browser.component.js";
export {
  parameterFieldsFromSchema,
  initialValuesFromFields,
  isComplete,
  type ParameterField,
  type FieldKind,
} from "./parameter-form/parameter-fields.js";
