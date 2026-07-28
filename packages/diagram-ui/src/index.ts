/**
 * @dicode/diagram-ui
 *
 * Lit + PixiJS custom elements (`<om-*>`) that render a Modelica
 * graphical layout inside the VSCode webview.
 *
 * Inputs:
 *   - `DiagramLayout` from `@dicode/omc-client` (the producer
 *     output over `getModelInstance` JSON).
 *   - SVG icon strings from `@dicode/diagram-svg`, rasterised
 *     into Pixi `Texture`s by the icon-provider.
 *
 * Composition:
 *   `<om-scene>` creates the Pixi renderer and provides a parentNodeCtx
 *   (`Container`). Each entity element (`<om-component>`,
 *   `<om-connector>`, `<om-edge>`, `<om-label>`, ...) is a thin
 *   Lit→Pixi bridge that consumes its parent container, creates one
 *   `Container`, syncs Lit properties to the scene graph, and provides
 *   itself as the parent context to its own children.
 */

export const PACKAGE_NAME = "@dicode/diagram-ui";

export { OmScene, type RendererFactory } from "./scene/scene.component.js";
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
  type GridOptions,
  type GridGraphics,
} from "./axis/grid-build.js";
export {
  OmGraphicalLayout,
  HOST_SHAPE_Z_BIAS,
} from "./graphical-layout/graphical-layout.component.js";
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
  ToolChangeDetail,
  ChangeClassRequestDetail,
  ClipboardRequestDetail,
  InteractionEndDetail,
} from "./graphical-layout/layout-events.js";
export { OmComponent } from "./component/component.component.js";
export { OmConnector } from "./connector/connector.component.js";
export { OmEdge } from "./connection/edge.component.js";
export { OmConnection } from "./connection/connection.component.js";
export { OmLabel } from "./label/label.component.js";
export { ensureLabelLayer } from "./label/label-texture.js";
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
  formatShapeKey,
  parseKey,
  isComponentKey,
  isConnectorKey,
  isShapeKey,
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
  type ShapeKey,
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
  applyShapeVertexDrag,
  applyShapeVertexInsert,
  applyShapeVertexDelete,
  applyShapeSmoothToggle,
  normaliseRect,
  selectByDiagramRect,
  type DiagramRect,
} from "./interaction/layout-ops.js";
export {
  type Picker as DragPicker,
  type ClientToDiagram,
  type DragEvents,
  type DragEmit,
  type SelectionProvider,
} from "./interaction/gesture-mode.js";
export {
  buildEdge,
  DEFAULT_EDGE_COLOR,
  EDGE_Z_OFFSET,
  type EdgeOptions,
} from "./connection/edge-build.js";
export { OmShapeElement } from "./base/shape-element.js";
export { OmShapeNode } from "./base/shape-node.js";
export { OmIconOverlay } from "./base/icon-overlay.component.js";
export { ResizeHandles, setHighlight } from "./base/selection-overlay.js";
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
  OmOverlayStack,
  type OverlayAnchor,
} from "./overlay-stack/overlay-stack.component.js";
export {
  OmActionPanel,
  type ActionPanelAnchor,
  type ActionPanelEvents,
  type ActionPanelEventName,
  type ActionCheckDetail,
  type ActionSimulateDetail,
  type ActionParametersDetail,
  type ActionRotateDetail,
  type ActionFlipDetail,
  type ActionToolDetail,
  type RotateDirection,
  type FlipAxis,
} from "./action-panel/action-panel.component.js";
export {
  OmSplitButton,
  type SplitButtonItem,
  type SplitButtonSelectDetail,
  type SplitButtonEvents,
} from "./action-panel/split-button.component.js";
export {
  EXTENT_KINDS,
  POLY_KINDS,
  type DrawKind,
  type ExtentKind,
  type PolyKind,
  type ToolId,
} from "./interaction/tools.js";
export {
  OmParameterForm,
  type ParameterFormChangeDetail,
  type ParameterFormSubmitDetail,
} from "./parameter-form/parameter-form.component.js";
export { OmParameterPanel } from "./parameter-form/parameter-panel.component.js";
export { OmErrorState } from "./error-state/error-state.component.js";
export type {
  LibraryDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
  LibraryEvents,
  LibrarySelectDetail,
  LibraryCancelDetail,
  LibraryContextMenuDetail,
} from "./library-tree/library-types.js";
export {
  OmContextMenu,
  type ContextMenuItem,
  type ContextMenuSelectDetail,
  type ContextMenuCloseDetail,
  type ContextMenuEvents,
} from "./context-menu/context-menu.component.js";
export {
  OmKeymapHelp,
  type KeymapHelpItem,
  type KeymapHelpGroup,
  type KeymapHelpCloseDetail,
  type KeymapHelpEvents,
} from "./keymap-help/keymap-help.component.js";
export { commandsToKeymapHelpGroups } from "./keymap-help/keymap-help-items.js";
export {
  OmLibraryTree,
  LIBRARY_TREE_DRAG_FORMAT,
  type LibraryPlacementStartDetail,
  type LibraryRootLoadedDetail,
} from "./library-tree/library-tree.component.js";
export {
  LIBRARY_TREE_ROOT_ID,
  createLibraryDataLoader,
  isExpandable as isLibraryClassExpandable,
  matchLabel,
  type LibraryTreeNode,
  type LibraryDataLoader,
  type LabelMatch,
} from "./library-tree/library-tree-model.js";
export {
  parameterFieldsFromModel,
  initialValuesFromFields,
  isComplete,
  type ParameterField,
  type FieldKind,
} from "./parameter-form/parameter-fields.js";
export type { DiagramCommandId } from "./commands/index.js";
