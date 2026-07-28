import type { Container } from "pixi.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import type {
  ClassDef,
  ComponentInstance,
  ConnectorInstance,
  DiagramLayout,
  IconLayer,
  Shape,
} from "@dicode/omc-client";
import { colorToCss } from "@dicode/diagram-svg";
import { omTokens } from "@dicode/ui-common";

import { renderShape } from "../primitives/render-shape.js";
import { lineThicknessScaleContext } from "../primitives/stroke-scale-context.js";
import { buildSubstitutions } from "../label/build-substitutions.js";
import "../scene/scene.component.js";
import "../axis/grid-axis.component.js";
import "../component/component.component.js";
import "../connector/connector.component.js";
import "../connection/connection.component.js";
import "../label/label.component.js";
import "../debug/perf-hud.component.js";
import "../context-menu/context-menu.component.js";
import "../keymap-help/keymap-help.component.js";
import type { OmScene, RendererFactory } from "../scene/scene.component.js";
import type { OmConnector } from "../connector/connector.component.js";
import type { OmComponent } from "../component/component.component.js";
import {
  defaultPicker,
  type InteractionEvents,
  type PickerFn,
  type PickerFactory,
} from "../interaction/interaction-manager.js";
import type { DragEvents } from "../interaction/gesture-mode.js";
import { ModeRouter } from "../interaction/mode.js";
import {
  applyAddGraphic,
  applyDeltaMove,
  applyEdgeSegmentDrag,
  applyResize,
  applyRotation,
  applyShapeVertexDrag,
  applyShapeVertexInsert,
  applySnapToExtents,
  applyWaypointDelete,
  applyWaypointDrag,
  applyWaypointInsert,
  retainExistingSelection,
  selectByDiagramRect,
  shapeCentre,
} from "../interaction/layout-ops.js";
import {
  chordFromEvent,
  CommandRegistry,
  DEFAULT_KEYMAP,
  DIAGRAM_COMMANDS,
  type CommandTarget,
  type DiagramCommandId,
} from "../commands/index.js";
import type {
  ContextMenuSelectDetail,
  OmContextMenu,
} from "../context-menu/context-menu.component.js";
import { commandsToMenuItems } from "../context-menu/command-menu-items.js";
import { nextContextSelection } from "../context-menu/context-selection.js";
import type { OmKeymapHelp } from "../keymap-help/keymap-help.component.js";
import { commandsToKeymapHelpGroups } from "../keymap-help/keymap-help-items.js";
import {
  deriveContextKeys,
  type ContextKeys,
} from "../interaction/context-keys.js";
import {
  entityKeyForNode,
  formatComponentKey,
  formatConnectorKey,
  formatShapeKey,
  isComponentKey,
  isConnectorKey,
  isEdgeKey,
  isJunctionKey,
  isShapeKey,
  parseKey,
  vertexKeyForEntity,
  vertexShapeKey,
} from "../interaction/node-keys.js";
import {
  orthogonalRoute,
  resolveConnectionWaypoints,
} from "../interaction/connection-route.js";
import {
  canConnect,
  resolvePortInfo,
  type CompatibilityResult,
} from "../interaction/connection-compat.js";
import {
  InteractionStateStore,
  interactionStateContext,
  type InteractionState,
} from "../interaction/interaction-state.js";
import {
  resolveSnapGrid,
  snapDelta,
  snapPoint,
  type SnapGrid,
} from "../interaction/snap-math.js";
import type { ToolId } from "../interaction/tools.js";
import type { ToolDraw } from "../interaction/tool-mode.js";
import { emitEvent } from "../dom-event.js";
import {
  LIBRARY_TREE_DRAG_FORMAT,
  parseLibraryDrag,
} from "../library-tree/library-drag.js";
import { leafLabel } from "../library-tree/library-tree-model.js";
import { buildPlacementPreview } from "./placement-preview.js";
import {
  PlacementController,
  pointInRect,
  type PlacementPoint,
} from "./placement-mode.js";
import type { LayoutEventName, LayoutEvents } from "./layout-events.js";

/**
 * Paint-order bias for the host class's shapes (own and inherited) so they
 * sit behind every component / connector but in front of the grid. Uses the
 * scene-z convention where positive is further from the viewer — both
 * primitive paths negate it into `zIndex`, then add `zForOrder(zOrder)` so
 * annotation-array order paints first-at-the-bottom within the band:
 *
 *   grid         zIndex = -1
 *   host shapes  zIndex = zForOrder(i) - HOST_SHAPE_Z_BIAS ← here
 *   components   zIndex =  0
 *
 * The band's capacity is where `zForOrder(i)` reaches the bias (500 shapes
 * at `SHAPE_Z_STEP` 0.001); a shape past that would paint over components.
 *
 * Shared by a shape's visual and its hit geometry so picks land in the same
 * band and a component always wins a pick over a shape beneath it.
 */
export const HOST_SHAPE_Z_BIAS = 0.5;

/** One host shape with its flat cross-layer paint index. `ownIndex` is the
 *  `shape:` key index within the host's own layer, `null` for an inherited
 *  shape. */
interface HostShapeSlot {
  shape: Shape;
  zOrder: number;
  ownIndex: number | null;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function layoutBoundingBox(layout: DiagramLayout): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;
  const addPlacement = (
    placement: import("@dicode/omc-client").Placement,
  ): void => {
    const [[x1, y1], [x2, y2]] = placement.extent;
    const ox = placement.origin?.[0] ?? 0;
    const oy = placement.origin?.[1] ?? 0;
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    const bo = Math.min(y1, y2);
    const to = Math.max(y1, y2);
    minX = Math.min(minX, ox + lo);
    maxX = Math.max(maxX, ox + hi);
    minY = Math.min(minY, oy + bo);
    maxY = Math.max(maxY, oy + to);
    seen = true;
  };
  for (const c of Object.values(layout.components)) {
    addPlacement(c.placement);
  }
  for (const k of Object.values(layout.connectors)) {
    addPlacement(k.placement);
  }
  for (const conn of layout.connections) {
    for (const [x, y] of conn.waypoints) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      seen = true;
    }
  }
  return seen ? { minX, minY, maxX, maxY } : null;
}

/**
 * Top-level `<om-graphical-layout>` element. Renders one Modelica
 * `DiagramLayout` and ties together every B/C/D/E piece:
 *
 *   <om-scene>
 *     <om-grid-axis>
 *     <om-component>...<om-connector>     # nested ports
 *     <om-connector>                       # host-level ports
 *     <om-connection>                      # routed edges + junctions
 *     <om-label>                           # host-level text
 *   </om-scene>
 *
 * Interaction wiring (driven by E1 + E3 + E4):
 *   - InteractionManager → hover / select / double-click / context-menu
 *   - DragController     → move / resize / rubber-band / connection
 *
 * State:
 *   - `selectedKeys` (Set<string>) of currently selected entities
 *   - `draftLayout` — set during a drag; cleared on commit. Rendered
 *     in place of `layout` while non-null so the user sees live
 *     feedback. On commit a `om-graphical-layout-change` CustomEvent
 *     fires with the new layout.
 *
 * Events emitted on `this`:
 *   - `om-graphical-layout-change` { detail: DiagramLayout }
 *   - `om-selection-change`        { detail: { keys: string[] } }
 *   - `om-double-click`            { detail: { key: string } }
 *   - `om-context-menu`            { detail: { key, clientX, clientY } }
 *   - `om-connection-create`       { detail: { fromKey, toKey, waypoints } }
 *   - `om-add-component-request`   { detail: { className, position } }
 *       — the user picked a class to instantiate, by dropping a row dragged
 *         from `<om-library-tree>` onto the canvas or by committing a
 *         host-mediated placement. The host wires this to `addComponent(...)`
 *         + a layout refresh.
 */
@customElement("om-graphical-layout")
export class OmGraphicalLayout extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        /* Belt-and-suspenders clip — see om-scene for the why. */
        overflow: hidden;
      }
      om-scene {
        width: 100%;
        height: 100%;
      }
      /* Drop affordance while a draggable library class hovers the canvas. */
      om-scene.om-drop-active {
        outline: var(--om-drop-outline-width) dashed
          var(--vscode-focusBorder, #007fd4);
        outline-offset: calc(-1 * var(--om-drop-outline-width));
      }

      /* Placement ghost follows the cursor in client space, so it is fixed to
       * the viewport (matching clientX/clientY) and must never eat the pointerup
       * that commits the drop. */
      .placement-ghost {
        position: fixed;
        pointer-events: none;
      }
      /* A cursor crosshair drawn with two gradient bars — no inline SVG, which
       * the webview CSP blocks as a glyph font and which happy-dom mis-parses. */
      .placement-crosshair {
        position: absolute;
        inline-size: var(--om-icon-size-md);
        block-size: var(--om-icon-size-md);
        transform: translate(-50%, -50%);
        background:
          linear-gradient(
              var(--vscode-focusBorder, currentColor),
              var(--vscode-focusBorder, currentColor)
            )
            center / 100% var(--om-drop-outline-width) no-repeat,
          linear-gradient(
              var(--vscode-focusBorder, currentColor),
              var(--vscode-focusBorder, currentColor)
            )
            center / var(--om-drop-outline-width) 100% no-repeat;
      }
      .placement-chip {
        position: absolute;
        inset-inline-start: var(--om-space-md);
        inset-block-start: var(--om-space-md);
        white-space: nowrap;
        padding: var(--om-space-2xs) var(--om-space-sm);
        border-radius: var(--om-radius-sm);
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--om-description-size);
        color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
        background: var(
          --vscode-editorWidget-background,
          var(--vscode-editor-background)
        );
        border: 1px solid var(--vscode-widget-border, transparent);
      }
    `,
  ];

  @property({ attribute: false })
  layout: DiagramLayout | null = null;

  @property({ type: Boolean, reflect: true })
  readonly = false;

  /**
   * Whether the host's clipboard holds something pasteable. Pushed in, not
   * tracked here: the clipboard is shared across editors, so a copy in another
   * diagram has to enable paste in this one.
   */
  @property({ type: Boolean, reflect: true, attribute: "has-clipboard" })
  hasClipboard = false;

  /** Optional renderer factory forwarded to the inner `<om-scene>`. Used
   *  by tests to mount renderer-less (factory returns `null`). */
  @property({ attribute: false })
  rendererFactory: RendererFactory | undefined = undefined;

  /** Optional picker factory. Defaults to `defaultPicker` (scene raycast);
   *  tests inject a deterministic picker so pointer gestures resolve to
   *  known entities without a live render. */
  @property({ attribute: false })
  pickerFactory: PickerFactory | undefined = undefined;

  /** Forwarded to `<om-scene>`: enables verbose icon-rasteriser logging. */
  @property({ type: Boolean, reflect: true })
  debug = false;

  /**
   * Forwarded to `<om-scene>` — `"2d"` (orthographic top-down editor)
   * or `"3d"` (free `ArcRotateCamera` orbit). The shape-element
   * overlay layer auto-hides in non-orthographic mode and the
   * in-canvas textured planes become the visible icon.
   */
  @property({ type: String, reflect: true, attribute: "camera-mode" })
  cameraMode: "2d" | "3d" = "2d";

  /**
   * Stroke-width multiplier published on `lineThicknessScaleContext`;
   * descendant shape primitives multiply their solid stroke width by it,
   * so one value scales every primitive stroke at once. `undefined` is the
   * renderer default.
   */
  @property({ type: Number, attribute: "line-thickness-scale" })
  lineThicknessScale: number | undefined = undefined;

  /**
   * Show the FPS / draw-call overlay (`<om-perf-hud>`). Off by default;
   * flip on from the webview to diagnose render-loop perf.
   */
  @property({ type: Boolean, reflect: true, attribute: "perf-hud" })
  perfHud = false;

  /**
   * Optional snap-to-grid override. Priority order:
   *   1. This property (when non-null).
   *   2. `layout.coordinateSystem.grid` from the Modelica annotation.
   *   3. `[2, 2]` (Modelica spec / OMEdit default).
   *
   * Set to `[0, 0]` to disable snapping entirely. Exposed as a
   * property (not an attribute) so a future settings UI can dial it
   * in at runtime without round-tripping through HTML attributes.
   */
  @property({ attribute: false })
  gridSnap: SnapGrid | null = null;

  /**
   * Snap increment (degrees) for drag-to-rotate. The dragged rotate
   * handle snaps the shape's angle to the nearest multiple of this;
   * `0` disables snapping (free rotation). Holding Shift during the
   * drag also forces free rotation regardless of this value.
   */
  @property({ type: Number, attribute: "rotate-snap-degrees" })
  rotateSnapDegrees = 5;

  /** Resolved snap grid for the current frame's `onDrag`/add events.
   *  Computed from `gridSnap` + `layout.coordinateSystem` each time we
   *  need it — cheap, and dodges stale-cache risk on layout swap. */
  private currentSnapGrid(): SnapGrid {
    return resolveSnapGrid(
      this.layout?.coordinateSystem,
      this.gridSnap ?? undefined,
    );
  }

  @state() private selectedKeys: Set<string> = new Set();
  @state() private draftLayout: DiagramLayout | null = null;
  @state() private hoverKey: string | null = null;
  /** Current connection-drag state, mirrored from the mode's `connection`
   *  events — drives the source/target port indicators and the red flag
   *  on an incompatible target. `null` outside a connection drag. */
  @state() private inProgressConnection: {
    from: string;
    toKey: string | null;
    compat: { ok: boolean; reason?: string } | null;
  } | null = null;
  /** True while a draggable library class hovers the canvas — drives the
   *  drop-affordance outline. Cleared on drop or when the drag leaves. */
  @state() private dropActive = false;
  /** The armed drawing tool. `select` (default) rubber-bands + picks; a draw
   *  tool routes input to its `ToolMode` (extent press-drag or multi-click
   *  poly). Sticky — stays armed across draws until reset (toolbar, Escape,
   *  or readonly). */
  @state() private activeTool: ToolId = "select";

  /** Host-mediated placement (a library row pressed in the sidebar webview and
   *  dragged onto the canvas). Armed via {@link beginPlacement}; the ghost and
   *  commit are driven by this element's own window pointer events. */
  private readonly placement = new PlacementController();
  @state() private placementClass: string | null = null;
  @state() private placementGhost: PlacementPoint | null = null;
  /** The armed class's renderable definition, once the host resolves it. Null
   *  until then, so the crosshair ghost stands in until the real node can draw. */
  @state() private placementPreview: ClassDef | null = null;
  private placementListening = false;

  @query("om-scene") private sceneEl?: OmScene;
  @query("om-context-menu") private contextMenuEl?: OmContextMenu;
  @query("om-keymap-help") private keymapHelpEl?: OmKeymapHelp;

  /** Diagram-space point the open context menu is anchored to (so it tracks
   *  that spot through pan/zoom). Null when the menu is closed. */
  private contextMenuAnchor: { x: number; y: number } | null = null;

  /** The vertex wire key a right-click landed on — target for `Delete vertex`.
   *  Set when the context menu opens on a vertex dot, cleared on close. */
  private contextVertex: string | null = null;

  private modeRouter: ModeRouter | null = null;
  private dblClickPicker: PickerFn | null = null;
  private dblClickCanvas: HTMLCanvasElement | null = null;
  /**
   * Authoritative interaction state. Every handler that changes "what
   * the user is doing" pushes through this store; the HUD (and future
   * overlays) subscribe via context. Kept separate from the `@state`
   * fields because external observers shouldn't have to know about
   * `draftLayout` etc. to read a state name.
   *
   * The `ContextProvider` is constructed for its side effect — it
   * registers itself with `this` as a Lit ReactiveController and
   * republishes the store value to any descendant consumer. We hold
   * no reference because the store identity never changes for the
   * element's lifetime, so we don't need to call `setValue` again.
   */
  private readonly interactionStore = new InteractionStateStore();

  /**
   * When set, the host (the VSCode extension) owns the diagram shortcuts: it
   * binds them as VSCode keybindings and pushes the resolved command id back
   * via {@link runCommandById}, so `onKeyDown` lets those chords propagate
   * instead of acting on them. Unset (the default, e.g. Storybook) keeps the
   * built-in {@link DEFAULT_KEYMAP} dispatch.
   */
  @property({ type: Boolean, attribute: "host-managed-keys" })
  hostManagedKeys = false;

  /**
   * The diagram command set + its key bindings. One registry backs both the
   * keymap dispatch (`onKeyDown`) and the public action methods the
   * action-panel buttons drive, so a shortcut and its button can't diverge.
   */
  private readonly commands = new CommandRegistry(DIAGRAM_COMMANDS);

  // Serves `lineThicknessScale` to every descendant shape primitive, which
  // reads it from context inside `buildStroke`.
  private readonly strokeScaleProvider = new ContextProvider(this, {
    context: lineThicknessScaleContext,
    initialValue: undefined,
  });

  constructor() {
    super();
    new ContextProvider(this, {
      context: interactionStateContext,
      initialValue: this.interactionStore,
    });
  }

  override willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    if (changed.has("lineThicknessScale")) {
      this.strokeScaleProvider.setValue(this.lineThicknessScale);
    }
  }

  /** Diagram-space point the preview node sits at, snapped to the active grid
   *  exactly as a commit is, or `null` when the cursor is off-canvas. */
  private previewPoint(): { x: number; y: number } | null {
    const ghost = this.placementGhost;
    if (ghost === null) return null;
    const raw = this.sceneEl?.clientToDiagram(ghost.x, ghost.y) ?? null;
    if (raw === null) return null;
    return snapPoint(raw.x, raw.y, this.currentSnapGrid());
  }

  /** The base layout with the placement preview merged in, or the base layout
   *  itself when no preview should render (not armed, class unresolved, or the
   *  cursor is off-canvas). */
  private layoutWithPreview(base: DiagramLayout): DiagramLayout {
    const def = this.placementPreview;
    if (this.placementClass === null || def === null) return base;
    const point = this.previewPoint();
    if (point === null) return base;
    return buildPlacementPreview(base, def, point);
  }

  override render(): TemplateResult {
    const base = this.draftLayout ?? this.layout;
    if (!base) {
      return html``;
    }
    const active = this.layoutWithPreview(base);
    // Mirrors `renderShape`'s `visible === false` skip (render-shape.ts):
    // OMEdit doesn't draw a hidden component either, so it gets no
    // `<om-component>` at all — unpickable and unselectable, same as a
    // hidden shape. `Placement.visible` is already resolved to a literal
    // by the producer (`placementFor`), so there's no DynamicSelect case
    // to peel here. Its connections still route from `layout.components`
    // directly (`endpointCentreFromLayout`), not from this element, so
    // they keep anchoring correctly with nothing left to crash into.
    const componentEntries = Object.entries(active.components).filter(
      ([, comp]) => comp.placement.visible !== false,
    );
    const connectorEntries = Object.entries(active.connectors);
    return html`
      <om-scene
        class=${this.dropActive ? "om-drop-active" : nothing}
        @om-view-change=${this.onViewChange}
        .rendererFactory=${this.rendererFactory ?? undefined}
        ?debug=${this.debug}
        camera-mode=${this.cameraMode}
        tabindex="0"
        @keydown=${this.onKeyDown}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <om-grid-axis
          .extent=${500}
          .coordinateSystem=${active.coordinateSystem ?? undefined}
        ></om-grid-axis>
        ${this.renderHostShapes(active)} ${this.renderHostShapeEntities(active)}
        ${repeat(
          componentEntries,
          // Class is part of the key so a "Change class" swap remounts the
          // node: a reused element keeps the previous class's icon children,
          // leaving old and new visuals overlaid. NUL can't appear in a
          // component name or qualified class name, so the split is
          // unambiguous.
          ([id, comp]) => `${id}\u0000${comp.classRef}`,
          ([id, comp]) => this.renderComponent(id, comp, active),
        )}
        ${repeat(
          connectorEntries,
          ([id]) => id,
          ([id, conn]) => this.renderStandaloneConnector(id, conn, active),
        )}
        ${repeat(
          active.connections,
          (_, idx) => `conn:${idx}`,
          (conn, idx) =>
            html`<om-connection
              .nodeId=${String(idx)}
              .path=${resolveConnectionWaypoints(active, conn)}
              .stroke=${conn.color ? colorToCss(conn.color) : undefined}
              .selectedKeys=${this.selectedKeys}
            ></om-connection>`,
        )}
        ${repeat(
          active.labels,
          (_, idx) => `lbl:${idx}`,
          (label, idx) =>
            html`<om-label
              .nodeId=${String(idx)}
              .text=${label.text}
              .x=${(label.extent[0][0] + label.extent[1][0]) / 2}
              .y=${(label.extent[0][1] + label.extent[1][1]) / 2}
              .rotation=${label.rotation}
              .fontSize=${label.fontSize ?? 12}
            ></om-label>`,
        )}
        <om-perf-hud ?show=${this.perfHud}></om-perf-hud>
      </om-scene>
      ${this.renderPlacementGhost()}
      <om-context-menu
        @om-context-menu-select=${this.onContextMenuSelect}
        @om-context-menu-close=${this.onContextMenuClose}
      ></om-context-menu>
      <om-keymap-help></om-keymap-help>
    `;
  }

  /** The cursor-tracking hint shown while a placement is armed and the cursor is
   *  over the canvas. The crosshair stands in until the real preview node can
   *  draw; once it does, only the status chip remains. Renders last so DOM order
   *  stacks it above the scene without a z-index. */
  private renderPlacementGhost(): TemplateResult | typeof nothing {
    const ghost = this.placementGhost;
    const cls = this.placementClass;
    if (!ghost || cls === null) {
      return nothing;
    }
    const hasNode = this.placementPreview !== null;
    return html`<div
      class="placement-ghost"
      style=${styleMap({ left: `${ghost.x}px`, top: `${ghost.y}px` })}
      aria-hidden="true"
    >
      ${hasNode ? nothing : html`<span class="placement-crosshair"></span>`}
      <span class="placement-chip"
        >Placing ${leafLabel(cls)} — release on canvas, Esc to cancel</span
      >
    </div>`;
  }

  override async firstUpdated(): Promise<void> {
    // Lit schedules child element updates *after* the parent's, so
    // when this fires the inner <om-scene> has been rendered into
    // our shadow DOM but its own `firstUpdated()` (where it mounts
    // the Pixi renderer + provides the scene context) hasn't run
    // yet. Awaiting its updateComplete lets that finish before we
    // try to grab the picker / canvas — otherwise both come back
    // null and the InteractionManager / DragController never attach,
    // which presents as "selection + drag silently don't work."
    if (this.sceneEl) {
      await this.sceneEl.updateComplete;
    }
    this.attachManagers();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("readonly") && this.readonly) {
      this.cancelPlacement();
    }
    if (changed.has("layout")) {
      this.draftLayout = null;
      if (!this.isInternalLayoutChange()) {
        // Keep the selection across an external layout swap when the
        // selected shapes survive it — this is what an edit echoed back
        // from the host looks like (rotate / resize / move re-fetch),
        // and deselecting there would yank the handles out from under
        // the gesture. A genuinely different model shares no keys, so
        // selection still empties.
        const retained = this.layout
          ? retainExistingSelection(this.layout, this.selectedKeys)
          : new Set<string>();
        this.selectedKeys = retained;
        this.interactionStore.next({ selectedKeys: Array.from(retained) });
      }
      this.internalLayoutChange = false;
    }
    if (
      !this.modeRouter &&
      this.sceneEl?.canvasElement &&
      this.sceneEl?.sceneContextValue
    ) {
      this.attachManagers();
    }
    // First layout → auto-fit so icons fill the viewport. Mirrors the
    // OMEdit / dyad-ui behaviour where opening a diagram zooms to its
    // content. Once the user pans / zooms manually we never re-fit
    // automatically; they can call `fitToContent()` to redo it.
    if (changed.has("layout") && !this.hasAutoFit && this.layout) {
      // Defer until after the scene has finished its own firstUpdated
      // so `clientToDiagram` / canvas size are valid.
      void this.scheduleAutoFit();
    }
  }

  private hasAutoFit = false;

  private async scheduleAutoFit(): Promise<void> {
    await this.updateComplete;
    await new Promise((r) => requestAnimationFrame(r));
    if (this.hasAutoFit) {
      return;
    }
    if (this.fitToContent()) {
      this.hasAutoFit = true;
    }
  }

  /**
   * Compute the bounding box of all components + connectors in the
   * current layout, then set the scene's zoom + pan so the box fills
   * the viewport with a small padding. Returns `true` if the fit was
   * applied, `false` if the layout was empty or the scene wasn't
   * mounted yet.
   */
  fitToContent(padding = 1.2): boolean {
    const layout = this.draftLayout ?? this.layout;
    const sceneEl = this.sceneEl;
    if (!layout || !sceneEl?.canvasElement) {
      return false;
    }
    const bbox = layoutBoundingBox(layout);
    if (!bbox) {
      return false;
    }
    const rect = sceneEl.canvasElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const aspect = rect.width / rect.height;
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;
    // Pick the half-height that contains the bbox under the current
    // aspect ratio. The wider dimension drives the zoom.
    const halfHForWidth = (w * padding) / (2 * aspect);
    const halfHForHeight = (h * padding) / 2;
    sceneEl.zoom = Math.max(halfHForWidth, halfHForHeight, 5);
    sceneEl.panX = (bbox.minX + bbox.maxX) / 2;
    sceneEl.panY = (bbox.minY + bbox.maxY) / 2;
    return true;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.detachManagers();
    // Disarm too, not just detach listeners — a detach mid-placement would
    // otherwise leave the controller armed with no listeners to end it.
    this.cancelPlacement();
  }

  private internalLayoutChange = false;
  private isInternalLayoutChange(): boolean {
    return this.internalLayoutChange;
  }

  private renderComponent(
    id: string,
    comp: ComponentInstance,
    layout: DiagramLayout,
  ): TemplateResult {
    const cls = layout.classes[comp.classRef];
    const key = formatComponentKey(id);
    const substitutions = buildSubstitutions(
      comp,
      cls,
      layout.resolvedParameters,
    );
    return html`<om-component
      .nodeId=${id}
      .placement=${comp.placement}
      .layers=${cls?.iconLayers ?? []}
      .coordinateSystem=${cls?.coordinateSystem ?? undefined}
      .lineThicknessScale=${this.lineThicknessScale}
      .substitutions=${substitutions}
      ?selected=${this.selectedKeys.has(key)}
      ?readonly=${this.readonly}
    >
      ${cls
        ? Object.entries(cls.connectors)
            // Per-instance gating: a port that's listed in
            // `comp.hiddenPorts` was elided by the producer because
            // its `condition` predicate evaluates to false for THIS
            // instance (e.g. `Torque(useSupport=false)` hides
            // `support`). The class def itself still lists the port
            // — sibling instances of the same type may have it
            // visible.
            .filter(([pid]) => !comp.hiddenPorts?.includes(pid))
            .map(
              ([pid, port]) =>
                html`<om-connector
                  .nodeId=${pid}
                  .placement=${port.placement}
                  .layers=${port.iconLayers}
                  .coordinateSystem=${cls.coordinateSystem ?? undefined}
                  .lineThicknessScale=${this.lineThicknessScale}
                  ?readonly=${this.readonly}
                ></om-connector>`,
            )
        : nothing}
    </om-component>`;
  }

  private renderStandaloneConnector(
    id: string,
    conn: ConnectorInstance,
    layout: DiagramLayout,
  ): TemplateResult {
    const cls = layout.classes[conn.classRef];
    const key = formatConnectorKey(null, id);
    return html`<om-connector
      .nodeId=${id}
      .placement=${conn.placement}
      .layers=${cls?.iconLayers ?? []}
      .coordinateSystem=${cls?.coordinateSystem ?? undefined}
      .lineThicknessScale=${this.lineThicknessScale}
      ?selected=${this.selectedKeys.has(key)}
      ?readonly=${this.readonly}
    ></om-connector>`;
  }

  /** The layer set the current view shows: `iconLayers` or `diagramLayers`. */
  private activeLayers(layout: DiagramLayout): IconLayer[] {
    return layout.kind === "icon" ? layout.iconLayers : layout.diagramLayers;
  }

  /** Every host shape with its flat cross-layer paint index. Layers arrive
   *  ancestor-first / host-last and the index follows that walk, so
   *  annotation-array order is paint order. */
  private hostShapeSlots(layout: DiagramLayout): HostShapeSlot[] {
    let zOrder = 0;
    return this.activeLayers(layout).flatMap((layer) => {
      const own = layer.from === layout.className;
      return layer.shapes.map((shape, index) => ({
        shape,
        zOrder: zOrder++,
        ownIndex: own ? index : null,
      }));
    });
  }

  /**
   * Paints the host's INHERITED (ancestor) shapes, non-interactive.
   * Own-layer shapes are drawn by their entity in
   * `renderHostShapeEntities`, which owns both their visual and their
   * interaction.
   */
  private renderHostShapes(layout: DiagramLayout): TemplateResult[] {
    return this.hostShapeSlots(layout)
      .filter((s) => s.ownIndex === null)
      .map((s) => renderShape(s.shape, s.zOrder, HOST_SHAPE_Z_BIAS));
  }

  /**
   * The host's OWN drawn shapes (`from === className`) as editable entities —
   * each its own `<om-*>` primitive owning its visual, hit geometry, and
   * selection overlay. Inherited ancestor shapes stay non-interactive.
   */
  private renderHostShapeEntities(layout: DiagramLayout): TemplateResult[] {
    return this.hostShapeSlots(layout).flatMap((s) =>
      s.ownIndex === null
        ? []
        : [
            renderShape(s.shape, s.zOrder, HOST_SHAPE_Z_BIAS, {
              index: s.ownIndex,
              selected: this.selectedKeys.has(
                formatShapeKey(s.shape.kind, s.ownIndex),
              ),
              // Selecting a graphic to copy it is not an edit, so a read-only
              // class keeps the entity and loses only the handles. `onDrag`
              // already refuses every gesture but the rubber band.
              editHandles: !this.readonly,
            }),
          ],
    );
  }

  /**
   * Look up the diagram-space position of the connector identified by
   * `key` (`k:<id>` for standalone, `k:<compId>.<portId>` for nested).
   * Resolves to the live `<om-connector>` element so the position
   * reflects any in-flight drafts (mid-drag component moves, etc.).
   */
  private connectorDiagramPosition(
    key: string,
  ): { x: number; y: number } | null {
    const conn = this.findConnectorElement(key);
    return conn ? conn.getPortDiagramPosition() : null;
  }

  /**
   * Run the local type / causality check between the connection-drag
   * source and (potential) target. Returns `null` when there's no
   * snap target yet — the renderer treats `null` the same as
   * "compatible" (no red light) until the user lands on a target.
   */
  private evaluateCompat(
    fromKey: string,
    toKey: string | null,
  ): CompatibilityResult | null {
    if (!toKey) return null;
    const layout = this.draftLayout ?? this.layout;
    if (!layout) return null;
    const from = resolvePortInfo(layout, fromKey);
    const to = resolvePortInfo(layout, toKey);
    if (!from || !to) return null;
    return canConnect(from, to);
  }

  /**
   * Find the live `<om-connector>` element for the given key, handling
   * both standalone (`k:p`) and nested (`k:R1.p`) forms.
   */
  private findConnectorElement(key: string): OmConnector | null {
    const parsed = parseKey(key);
    if (!parsed || !isConnectorKey(parsed)) {
      return null;
    }
    const root = this.sceneEl;
    if (!root) {
      return null;
    }
    if (parsed.componentName === null) {
      // Standalone: pick the first connector with this portName that
      // isn't nested under a component.
      for (const el of root.querySelectorAll("om-connector")) {
        const conn = el as OmConnector;
        if (conn.nodeId === parsed.portName && !conn.closest("om-component")) {
          return conn;
        }
      }
      return null;
    }
    for (const el of root.querySelectorAll("om-component")) {
      const comp = el as OmComponent;
      if (comp.nodeId !== parsed.componentName) continue;
      for (const child of comp.querySelectorAll("om-connector")) {
        const conn = child as OmConnector;
        if (conn.nodeId === parsed.portName) {
          return conn;
        }
      }
    }
    return null;
  }

  /**
   * Recompute which connectors should show their port indicators and
   * apply the change. The indicator is the "drag-here-to-make-a-
   * connection" affordance — without it, the connector's port mesh is
   * invisible (and therefore unpickable), so the user can't start a
   * connection drag.
   *
   * Visible while either:
   *   - the user hovers a component (show all its connectors' ports),
   *   - the user hovers a connector (show that port),
   *   - the user is mid connection drag (keep source + target visible).
   */
  private refreshPortIndicators(): void {
    const sceneEl = this.sceneEl;
    if (!sceneEl) {
      return;
    }
    const visible = new Set<OmConnector>();
    const addByConnectorKey = (key: string): void => {
      const conn = this.findConnectorElement(key);
      if (conn) {
        visible.add(conn);
      }
    };
    const addAllPortsOfComponent = (id: string): void => {
      for (const el of sceneEl.querySelectorAll("om-component")) {
        const comp = el as OmComponent;
        if (comp.nodeId !== id) continue;
        for (const child of comp.querySelectorAll("om-connector")) {
          visible.add(child as OmConnector);
        }
      }
    };
    const parsedHover = this.hoverKey ? parseKey(this.hoverKey) : null;
    if (parsedHover && isComponentKey(parsedHover)) {
      addAllPortsOfComponent(parsedHover.nodeId);
    } else if (parsedHover && isConnectorKey(parsedHover) && this.hoverKey) {
      addByConnectorKey(this.hoverKey);
    }
    const ip = this.inProgressConnection;
    if (ip) {
      addByConnectorKey(ip.from);
      if (ip.toKey) {
        addByConnectorKey(ip.toKey);
      }
    }
    // Identify the snap-target connector during an incompatible drag
    // so its hover outline can be red-flagged. (The source connector
    // and any non-target hovered connectors stay blue — we're only
    // calling out the rejected drop.)
    const errorTarget =
      ip && ip.toKey && ip.compat && !ip.compat.ok
        ? this.findConnectorElement(ip.toKey)
        : null;
    for (const el of sceneEl.querySelectorAll("om-connector")) {
      const conn = el as OmConnector;
      const want = visible.has(conn);
      const variant: "normal" | "error" =
        conn === errorTarget ? "error" : "normal";
      if (conn.portIndicatorVisible !== want) {
        conn.setPortIndicatorVisible(want);
      }
      if (conn.isHovered !== want || conn.hoveredVariant !== variant) {
        conn.setHovered(want, variant);
      }
    }
    // Junction discs self-manage: `<om-connection>` subscribes to
    // `interactionStateContext` and reacts to `hoverKey` changes directly,
    // so we don't walk them here.
  }

  private attachManagers(): void {
    if (this.modeRouter) {
      return;
    }
    const sceneEl = this.sceneEl;
    const ctx = sceneEl?.sceneContextValue;
    const canvas = sceneEl?.canvasElement;
    if (!sceneEl || !ctx || !canvas) {
      return;
    }
    const picker = (this.pickerFactory ?? defaultPicker)(ctx, canvas);
    this.modeRouter = new ModeRouter({
      canvas,
      picker,
      clientToDiagram: (cx, cy) => sceneEl.clientToDiagram(cx, cy),
      getSelectionKeys: () => Array.from(this.selectedKeys),
      onInteraction: (type, detail) => this.onInteraction(type, detail),
      onDrag: (type, detail) => this.onDrag(type, detail),
      store: this.interactionStore,
      overlayParent: ctx.diagramRoot,
      connectorPosition: (key) => this.connectorDiagramPosition(key),
      evaluateCompat: (from, toKey) => this.evaluateCompat(from, toKey),
      getActiveTool: () => this.activeTool,
      getSnapGrid: () => this.currentSnapGrid(),
      onTool: (draw) => this.onTool(draw),
    });
    // Native dblclick on empty canvas → open the library browser.
    // InteractionManager's `doubleClick` only fires on hits; this path
    // catches the empty-space case without changing its contract.
    this.dblClickPicker = picker;
    this.dblClickCanvas = canvas;
    canvas.addEventListener("dblclick", this.onCanvasDblClick);
  }

  private detachManagers(): void {
    this.modeRouter?.destroy();
    this.modeRouter = null;
    if (this.dblClickCanvas) {
      this.dblClickCanvas.removeEventListener(
        "dblclick",
        this.onCanvasDblClick,
      );
      this.dblClickCanvas = null;
    }
    this.dblClickPicker = null;
  }

  private onCanvasDblClick = (e: MouseEvent): void => {
    if (this.readonly || !this.dblClickPicker) {
      return;
    }
    // An armed draw tool consumes the double-click (a multi-click draw
    // finishes on it); the waypoint path is skipped.
    if (this.modeRouter?.handleDoubleClick()) {
      return;
    }
    const node = this.dblClickPicker(e.clientX, e.clientY);
    // Double-clicking a polyline edits its vertices: a connection edge
    // inserts a waypoint (a junction disc deletes one); a poly shape's
    // line inserts a vertex at the click.
    if (node) {
      this.handlePolylineDblClick(node, e);
    }
  };

  /**
   * Resolve a double-click on a polyline into a vertex edit and commit it:
   * a connection edge inserts a waypoint, a junction disc deletes one, and
   * a poly host shape's line inserts a vertex at the click. No-op when the
   * picked node isn't an editable polyline.
   */
  private handlePolylineDblClick(node: Container, e: MouseEvent): void {
    if (!this.layout) {
      return;
    }
    const entity = entityKeyForNode(node);
    if (!entity) {
      return;
    }
    if (
      isShapeKey(entity) &&
      (entity.shapeKind === "line" || entity.shapeKind === "polygon")
    ) {
      const point = this.sceneEl?.clientToDiagram(e.clientX, e.clientY);
      if (!point) {
        return;
      }
      this.commitLayout(
        applyShapeVertexInsert(
          this.layout,
          formatShapeKey(entity.shapeKind, entity.index),
          point,
        ),
      );
      return;
    }
    if (isEdgeKey(entity)) {
      // Edge nodeId is the connection index.
      const connIdx = Number(entity.nodeId);
      const point = this.sceneEl?.clientToDiagram(e.clientX, e.clientY);
      if (Number.isNaN(connIdx) || !point) {
        return;
      }
      this.commitLayout(
        applyWaypointInsert(
          this.withMaterialisedRoute(this.layout, connIdx),
          connIdx,
          point,
        ),
      );
      return;
    }
    if (isJunctionKey(entity)) {
      // Junction nodeId is the compound `<connIdx>/<waypointIdx>`.
      const slash = entity.nodeId.indexOf("/");
      if (slash < 0) {
        return;
      }
      const connIdx = Number(entity.nodeId.slice(0, slash));
      const waypointIdx = Number(entity.nodeId.slice(slash + 1));
      if (Number.isNaN(connIdx) || Number.isNaN(waypointIdx)) {
        return;
      }
      this.commitLayout(applyWaypointDelete(this.layout, connIdx, waypointIdx));
    }
  }

  /**
   * Reshape a connection's route around a dragged waypoint, keeping it
   * orthogonal. `nodeId` is the junction's compound id
   * (`<connIdx>/<waypointIdx>`); a malformed id leaves the layout
   * untouched.
   */
  private applyJunctionReshape(
    layout: DiagramLayout,
    nodeId: string,
    dx: number,
    dy: number,
  ): DiagramLayout {
    const slash = nodeId.indexOf("/");
    if (slash < 0) {
      return layout;
    }
    const connIdx = Number(nodeId.slice(0, slash));
    const waypointIdx = Number(nodeId.slice(slash + 1));
    if (Number.isNaN(connIdx) || Number.isNaN(waypointIdx)) {
      return layout;
    }
    return applyWaypointDrag(
      this.withMaterialisedRoute(layout, connIdx),
      connIdx,
      waypointIdx,
      dx,
      dy,
    );
  }

  /**
   * Returns a layout copy where the connection at `connIdx` has its
   * waypoints materialised from endpoint positions when they are currently
   * empty (`waypoints: []`). Returns the original layout reference when the
   * connection already has a route or can't be resolved.
   */
  private withMaterialisedRoute(
    layout: DiagramLayout,
    connIdx: number,
  ): DiagramLayout {
    const conn = layout.connections[connIdx];
    if (!conn || conn.waypoints.length > 0) {
      return layout;
    }
    const waypoints = resolveConnectionWaypoints(layout, conn);
    if (waypoints.length < 2) {
      return layout;
    }
    const connections = layout.connections.map((c, i) =>
      i === connIdx ? { ...c, waypoints } : c,
    );
    return { ...layout, connections };
  }

  /** Snap a diagram-space point to the active grid and ask the host to
   *  instantiate `className` there. Single-sourced so every add path (drag-drop,
   *  host-mediated placement) lands on a grid intersection under the same rule
   *  and a first move doesn't visibly "correct" the position. */
  private requestAddComponent(
    className: string,
    point: { x: number; y: number },
  ): void {
    const position = snapPoint(point.x, point.y, this.currentSnapGrid());
    this.emit("om-add-component-request", { className, position });
  }

  /** Accept a class dragged from `<om-library-tree>` iff the drag carries our
   *  format; `preventDefault` marks the canvas a valid `copy` drop target.
   *  Other drags fall through untouched so we don't hijack them. */
  private onDragOver = (e: DragEvent): void => {
    if (this.readonly) {
      return;
    }
    const dt = e.dataTransfer;
    if (!dt || !dt.types.includes(LIBRARY_TREE_DRAG_FORMAT)) {
      return;
    }
    e.preventDefault();
    dt.dropEffect = "copy";
    this.dropActive = true;
  };

  // `dragleave` fires whenever the cursor crosses onto any child of
  // `om-scene` (the events bubble up), not just when it leaves the canvas —
  // clearing unconditionally would flicker the affordance over a populated
  // diagram. Keep it lit while the cursor is still within the scene subtree.
  private onDragLeave = (e: DragEvent): void => {
    const scene = this.sceneEl;
    const next = e.relatedTarget;
    if (scene && next instanceof Node && scene.contains(next)) {
      return;
    }
    this.dropActive = false;
  };

  /** Instantiate the dragged class at the drop point. No-op when readonly, when
   *  the payload is missing/malformed, or when the drop coordinates can't be
   *  mapped into diagram space (canvas not yet sized). */
  private onDrop = (e: DragEvent): void => {
    this.dropActive = false;
    const dt = e.dataTransfer;
    if (this.readonly || !dt || !dt.types.includes(LIBRARY_TREE_DRAG_FORMAT)) {
      return;
    }
    e.preventDefault();
    const className = parseLibraryDrag(dt.getData(LIBRARY_TREE_DRAG_FORMAT));
    if (className === null) {
      return;
    }
    const point = this.sceneEl?.clientToDiagram(e.clientX, e.clientY) ?? null;
    if (point === null) {
      return;
    }
    this.requestAddComponent(className, point);
  };

  /**
   * Arm host-mediated placement for `className`. The diagram then tracks its own
   * window pointer events: a ghost follows the cursor over the canvas and a
   * release there instantiates the class (the same {@link requestAddComponent}
   * path a drop uses). No-op when readonly or `className` is empty.
   */
  beginPlacement(className: string): void {
    if (this.readonly || className === "") {
      return;
    }
    this.placement.begin(className);
    this.placementClass = this.placement.active;
    this.placementGhost = null;
    this.placementPreview = null;
    this.addPlacementListeners();
  }

  /** Disarm placement and drop the ghost (e.g. the host relayed a cancel). */
  cancelPlacement(): void {
    if (this.placement.active === null) {
      return;
    }
    this.placement.reset();
    this.placementClass = null;
    this.placementGhost = null;
    this.placementPreview = null;
    this.removePlacementListeners();
  }

  /**
   * Supply (or clear) the renderable definition of the armed class, so the
   * preview shows the real component instead of the crosshair. Ignored unless a
   * placement for `def.name` is armed, so a late resolution for a superseded or
   * cancelled placement can't paint a stale node.
   */
  setPlacementPreview(def: ClassDef | null): void {
    if (def !== null && this.placementClass !== def.name) {
      return;
    }
    this.placementPreview = def;
  }

  /** The class name of the armed placement, or `null` when idle. */
  get placementClassName(): string | null {
    return this.placementClass;
  }

  /** Client-space ghost anchor while the cursor is over the canvas, else `null`
   *  (idle or off-canvas). Drives {@link renderPlacementGhost}. */
  get placementGhostPoint(): PlacementPoint | null {
    return this.placementGhost;
  }

  private isOverCanvas(x: number, y: number): boolean {
    const rect = this.sceneEl?.getBoundingClientRect();
    return rect ? pointInRect(x, y, rect) : false;
  }

  private readonly onPlacementMove = (e: MouseEvent): void => {
    if (this.placement.active === null) {
      return;
    }
    this.placementGhost = this.placement.move(
      e.clientX,
      e.clientY,
      this.isOverCanvas(e.clientX, e.clientY),
    );
  };

  private readonly onPlacementUp = (e: MouseEvent): void => {
    const className = this.placement.active;
    if (className === null) {
      return;
    }
    const point = this.placement.release(
      e.clientX,
      e.clientY,
      this.isOverCanvas(e.clientX, e.clientY),
    );
    this.placementClass = null;
    this.placementGhost = null;
    this.placementPreview = null;
    this.removePlacementListeners();
    if (point === null) {
      return;
    }
    const diagramPoint =
      this.sceneEl?.clientToDiagram(point.x, point.y) ?? null;
    if (diagramPoint === null) {
      return;
    }
    this.requestAddComponent(className, diagramPoint);
  };

  private readonly onPlacementKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.cancelPlacement();
    }
  };

  private addPlacementListeners(): void {
    if (this.placementListening) {
      return;
    }
    this.placementListening = true;
    window.addEventListener("pointermove", this.onPlacementMove);
    window.addEventListener("pointerup", this.onPlacementUp);
    window.addEventListener("keydown", this.onPlacementKeyDown);
  }

  private removePlacementListeners(): void {
    if (!this.placementListening) {
      return;
    }
    this.placementListening = false;
    window.removeEventListener("pointermove", this.onPlacementMove);
    window.removeEventListener("pointerup", this.onPlacementUp);
    window.removeEventListener("keydown", this.onPlacementKeyDown);
  }

  private onInteraction<K extends keyof InteractionEvents>(
    type: K,
    detail: InteractionEvents[K],
  ): void {
    // A resolved placement renders its synthetic preview node into the scene,
    // where the picker can hit it. Placement owns the pointer, so hover and
    // select must not act on it — otherwise `$placement-preview` escapes on
    // `om-selection-change`.
    if (this.placementClass !== null) {
      return;
    }
    switch (type) {
      case "hover": {
        const d = detail as InteractionEvents["hover"];
        if (this.hoverKey === d.key) {
          return;
        }
        this.hoverKey = d.key;
        // Drag-active gate: suppress port-indicator + outline refresh
        // while any pointer drag is in flight (move / resize /
        // rubber-band / connection-pending). Without this, every
        // pointermove during a drag would flash dots and outlines on
        // the connectors the cursor sweeps over — visible flicker.
        //
        // We read the mode's `isGestureActive()`, NOT
        // `interactionStore.state.kind`, because the InteractionManager's
        // pointermove listener is registered before DragController's
        // and so its hover emit races ahead of the state-machine
        // transition on the FIRST move of a drag. The gesture flag flips
        // on pointerdown, which is the earlier and correct signal.
        //
        // For active connection drags we keep refreshes flowing
        // (refreshPortIndicators reads `inProgressConnection`, which
        // is the snap-target signal).
        const stateKind = this.interactionStore.value.state.kind;
        const dragActive = this.modeRouter?.isGestureActive() ?? false;
        const suppress = dragActive && stateKind !== "connecting";
        if (!suppress) {
          this.refreshPortIndicators();
        }
        // Hover state only updates the machine when there's no
        // active drag — a drag preempts hover so `state.kind`
        // stays on `moving` / `connecting` / etc. until release.
        if (stateKind === "idle" || stateKind === "hovering") {
          this.interactionStore.next({
            hoverKey: d.key,
            state: d.key ? { kind: "hovering", key: d.key } : { kind: "idle" },
          });
        } else {
          this.interactionStore.next({ hoverKey: d.key });
        }
        return;
      }
      case "select": {
        const d = detail as InteractionEvents["select"];
        this.applySelection(d.key, d.addToSelection);
        return;
      }
      case "doubleClick": {
        const d = detail as InteractionEvents["doubleClick"];
        this.emit("om-double-click", { key: d.key });
        return;
      }
      case "contextMenu": {
        const d = detail as InteractionEvents["contextMenu"];
        this.emit("om-context-menu", d);
        // A right-click on a vertex dot targets that vertex (keeping the
        // shape selected); anything else adjusts selection as usual.
        this.contextVertex = this.resolveContextVertex(d.clientX, d.clientY);
        if (!this.contextVertex) {
          this.selectForContext(d.key);
        }
        this.openContextMenu(d.clientX, d.clientY);
        return;
      }
    }
  }

  private applySelection(key: string, additive: boolean): void {
    const next = additive ? new Set(this.selectedKeys) : new Set<string>();
    if (additive && next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.selectedKeys = next;
    this.emit("om-selection-change", { keys: Array.from(next) });
    this.interactionStore.next({ selectedKeys: Array.from(next) });
  }

  /** Single entry point for state transitions driven by `DragController`. */
  private setInteractionState(state: InteractionState): void {
    this.interactionStore.next({ state });
  }

  /** Returns to either `hovering` (if a hover key exists) or `idle`. */
  private endInteraction(): void {
    const hoverKey = this.hoverKey;
    this.setInteractionState(
      hoverKey ? { kind: "hovering", key: hoverKey } : { kind: "idle" },
    );
    // Port-indicator updates were suppressed during the drag (see the
    // hover handler); reconcile the visible state against the current
    // hover key now that the drag is over.
    this.refreshPortIndicators();
  }

  private onDrag<K extends keyof DragEvents>(
    type: K,
    detail: DragEvents[K],
  ): void {
    if (!this.layout) {
      return;
    }
    // Rubber-band is the one gesture here that moves nothing — it only sets
    // the selection, so it stays live on a read-only class. Copying a
    // sub-system out of a system-library model needs multi-select.
    if (this.readonly && type !== "rubberBand") {
      return;
    }
    switch (type) {
      case "drag": {
        const d = detail as DragEvents["drag"];
        // Snap the drag delta to the active grid so components glide
        // in whole-step increments. With grid {2,2} (the Modelica
        // default) sub-step pointer moves render as no-ops, which
        // gives the gesture an OMEdit-style "magnetic" feel.
        const grid = this.currentSnapGrid();
        const { dx, dy } = snapDelta(d.dx, d.dy, grid);
        // A lone waypoint reshapes its route orthogonally (inserting
        // jogs) rather than translating; anything else (components,
        // multi-selection) is a plain move.
        const only = d.keys.length === 1 ? d.keys[0] : undefined;
        const single = only ? parseKey(only) : null;
        if (single && isJunctionKey(single)) {
          const moved = this.applyJunctionReshape(
            this.layout,
            single.nodeId,
            dx,
            dy,
          );
          if (d.draft) {
            this.draftLayout = moved;
            this.setInteractionState({ kind: "moving", keys: d.keys });
          } else {
            this.commitLayout(moved);
            this.endInteraction();
          }
          return;
        }
        const moved = applyDeltaMove(this.layout, d.keys, dx, dy);
        if (d.draft) {
          this.draftLayout = moved;
          this.setInteractionState({ kind: "moving", keys: d.keys });
        } else {
          // On commit, snap each moved entity's extent corners to
          // the grid. `snapDelta` only rounds the delta, so a
          // component that started off-grid would stay off-grid
          // after any move — this pass pulls the final values onto
          // grid intersections (matches OMEdit's "Snap to Grid" on
          // mouse-up).
          this.commitLayout(applySnapToExtents(moved, d.keys, grid));
          this.endInteraction();
        }
        return;
      }
      case "edgeDrag": {
        const d = detail as DragEvents["edgeDrag"];
        const grid = this.currentSnapGrid();
        const { dx, dy } = snapDelta(d.dx, d.dy, grid);
        const moved = applyEdgeSegmentDrag(
          this.withMaterialisedRoute(this.layout, d.connIdx),
          d.connIdx,
          d.grab,
          dx,
          dy,
        );
        if (d.draft) {
          this.draftLayout = moved;
          this.setInteractionState({
            kind: "moving",
            keys: [`edge:${d.connIdx}`],
          });
        } else {
          this.commitLayout(moved);
          this.endInteraction();
        }
        return;
      }
      case "rubberBand": {
        const d = detail as DragEvents["rubberBand"];
        if (d.draft) {
          // Live selection preview.
          this.selectedKeys = selectByDiagramRect(this.layout, d.rect);
          this.interactionStore.next({
            selectedKeys: Array.from(this.selectedKeys),
          });
          this.setInteractionState({ kind: "selecting" });
        } else {
          const keys = selectByDiagramRect(this.layout, d.rect);
          this.selectedKeys = keys;
          this.emit("om-selection-change", { keys: Array.from(keys) });
          this.interactionStore.next({ selectedKeys: Array.from(keys) });
          this.endInteraction();
        }
        return;
      }
      case "connection": {
        const d = detail as DragEvents["connection"];
        if (!d.commit) {
          // `fromPoint` / `compat` are resolved by ConnectMode (which
          // already needs them to draw the wire) and ride on the event,
          // so the host doesn't re-walk the shadow DOM or re-run the
          // compat check on every pointermove.
          this.inProgressConnection = {
            from: d.from,
            toKey: d.toKey,
            compat: d.compat,
          };
          this.refreshPortIndicators();
          this.setInteractionState({
            kind: "connecting",
            fromKey: d.from,
            toKey: d.toKey,
          });
        } else {
          this.inProgressConnection = null;
          this.refreshPortIndicators();
          // Only emit when we have a snap target AND the local check
          // didn't reject it. Incompatible drops silently fail —
          // matches what the user just saw (red wire) and avoids a
          // round-trip to OMC for a connection we know it would reject.
          if (d.toKey && (d.compat === null || d.compat.ok)) {
            const toPoint = this.connectorDiagramPosition(d.toKey);
            const waypoints = toPoint
              ? orthogonalRoute(d.fromPoint, toPoint)
              : [];
            this.emit("om-connection-create", {
              fromKey: d.from,
              toKey: d.toKey,
              waypoints,
            });
          }
          this.endInteraction();
        }
        return;
      }
      case "resize": {
        // Snap the moving corner to the grid, then drag that corner of
        // the shape's extent. Live-preview on draft, persist on commit —
        // the same draftLayout → commitLayout pipeline `move` uses.
        const d = detail as DragEvents["resize"];
        const grid = this.currentSnapGrid();
        const { x, y } = snapPoint(d.x, d.y, grid);
        const resized = applyResize(this.layout, d.key, d.corner, x, y);
        if (d.draft) {
          this.draftLayout = resized;
          this.setInteractionState({
            kind: "resizing",
            key: d.key,
            corner: d.corner,
          });
        } else {
          this.commitLayout(resized);
          this.endInteraction();
        }
        return;
      }
      case "rotate": {
        // Drag-to-rotate: derive the angle from the owner shape's centre
        // to the pointer (the handle sits due north at 0°). Snap to
        // `rotateSnapDegrees` unless the drag is free (Shift). Rotate
        // whatever's selected, falling back to the handle's own owner.
        const d = detail as DragEvents["rotate"];
        const pivot = shapeCentre(this.layout, d.key);
        if (!pivot) {
          return;
        }
        // Reuse the live selection when the handle's owner is in it
        // (the usual case — the handle only shows on a selected shape);
        // the array fallback mirrors `move`/`resize` and avoids minting
        // a Set on every pointermove.
        const keys = this.selectedKeys.has(d.key) ? this.selectedKeys : [d.key];
        const raw =
          (Math.atan2(d.y - pivot[1], d.x - pivot[0]) * 180) / Math.PI - 90;
        const snap = d.free ? 0 : this.rotateSnapDegrees;
        const deg = snap > 0 ? Math.round(raw / snap) * snap : raw;
        const rotated = applyRotation(this.layout, keys, deg);
        if (d.draft) {
          this.draftLayout = rotated;
          this.setInteractionState({ kind: "rotating", key: d.key });
        } else {
          this.commitLayout(rotated);
          this.endInteraction();
        }
        return;
      }
      case "vertexDrag": {
        // Drag one vertex of a poly shape to the snapped pointer. Live
        // preview on draft, persist on commit — same pipeline as resize.
        const d = detail as DragEvents["vertexDrag"];
        const vertex = parseKey(d.key);
        if (!vertex || vertex.kind !== "vertex-handle") {
          return;
        }
        const shapeKey = vertexShapeKey(vertex);
        const { x, y } = snapPoint(d.x, d.y, this.currentSnapGrid());
        const edited = applyShapeVertexDrag(
          this.layout,
          shapeKey,
          vertex.vertexIndex,
          x,
          y,
        );
        if (d.draft) {
          this.draftLayout = edited;
          this.setInteractionState({ kind: "moving", keys: [shapeKey] });
        } else {
          this.commitLayout(edited);
          this.endInteraction();
        }
        return;
      }
    }
  }

  private commitLayout(layout: DiagramLayout): void {
    this.draftLayout = null;
    // `applyDeltaMove` / `applyRotate` / `applyFlip` / `applyDelete`
    // all short-circuit to the same reference when there's no actual
    // change (zero delta, empty keys, etc). Don't fire a change
    // event in that case — consumers downstream (the extension's
    // diff layer) would treat it as a real edit and round-trip OMC
    // for nothing.
    if (layout === this.layout) {
      return;
    }
    this.internalLayoutChange = true;
    this.layout = layout;
    this.emit("om-graphical-layout-change", layout);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // An armed tool owns its keys first (Enter / Backspace / Escape for a
    // multi-click draw); only if it doesn't consume the key do the disarm
    // shortcut and the keymap run.
    if (this.modeRouter?.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && this.activeTool !== "select") {
      this.setActiveTool("select");
      e.preventDefault();
      return;
    }
    if (this.hostManagedKeys) {
      return;
    }
    const id = DEFAULT_KEYMAP.get(chordFromEvent(e));
    if (id && this.runCommand(id)) {
      e.preventDefault();
    }
  };

  /**
   * Applies a draw step from the armed `ToolMode`. The mode owns the shape
   * (snapping, guards, preview kind); the host only places it into whichever
   * layer this view edits (icon vs diagram): a draft previews, a commit
   * persists + disarms, a cancel drops the preview and stays armed.
   */
  private onTool(draw: ToolDraw): void {
    if (this.readonly || !this.layout) {
      return;
    }
    if (draw.phase === "cancel") {
      this.draftLayout = null;
      this.endInteraction();
      return;
    }
    const next = applyAddGraphic(this.layout, this.layout.kind, draw.shape);
    if (draw.phase === "draft") {
      this.draftLayout = next;
      this.setInteractionState({ kind: "drawing" });
      return;
    }
    this.draftLayout = null;
    this.commitLayout(next);
    this.endInteraction();
    this.setActiveTool("select"); // one shape per arming
  }

  /** The currently armed drawing tool. */
  get tool(): ToolId {
    return this.activeTool;
  }

  /** Arm a drawing tool, or `select` to disarm. A readonly diagram can't
   *  draw, so it stays on `select`. Emits `om-tool-change` so an external
   *  toolbar can mirror the armed tool. */
  setActiveTool(tool: ToolId): void {
    const next: ToolId = this.readonly ? "select" : tool;
    if (next !== this.activeTool) {
      // Switching tools mid-draw abandons whatever the old tool had in flight.
      this.modeRouter?.cancelActiveTool();
      this.activeTool = next;
      this.emit("om-tool-change", { tool: next });
    }
  }

  /** The diagram surface a command mutates — an adapter over this element. */
  private commandTarget(): CommandTarget {
    return {
      layout: this.layout,
      selectedKeys: this.selectedKeys,
      contextVertex: this.contextVertex,
      commitLayout: (next) => this.commitLayout(next),
      setSelection: (keys) => this.setSelection(keys),
      requestClassChange: (componentName, currentClass) => {
        this.emit("om-change-class-request", { componentName, currentClass });
      },
      requestClipboard: (action) => {
        this.emit(
          "om-clipboard-request",
          action === "copy"
            ? { action, keys: Array.from(this.selectedKeys) }
            : { action },
        );
      },
      showKeymapHelp: () => this.openKeymapHelp(),
    };
  }

  /** Open the keyboard-shortcuts help dialog, sourced from the same command
   *  registry and keymap the context menu and action panel read. */
  private openKeymapHelp(): void {
    const el = this.keymapHelpEl;
    if (!el) {
      return;
    }
    el.groups = commandsToKeymapHelpGroups(
      this.commands,
      DEFAULT_KEYMAP,
      this.commandContext(),
    );
    el.open = true;
  }

  /** Resolve a right-click position to the vertex wire key under it, if any. */
  private resolveContextVertex(
    clientX: number,
    clientY: number,
  ): string | null {
    const node = this.dblClickPicker?.(clientX, clientY) ?? null;
    const entity = node ? entityKeyForNode(node) : null;
    return entity ? vertexKeyForEntity(entity) : null;
  }

  /** True when exactly one line / polygon host shape is selected. */
  private singlePolyShapeSelected(): boolean {
    if (this.selectedKeys.size !== 1) {
      return false;
    }
    const [key] = this.selectedKeys;
    const parsed = key ? parseKey(key) : null;
    return (
      !!parsed &&
      isShapeKey(parsed) &&
      (parsed.shapeKind === "line" || parsed.shapeKind === "polygon")
    );
  }

  private commandContext(): ContextKeys {
    // Selection comes from `this.selectedKeys` — the same set `commandTarget`
    // mutates — so a command's `when` and `run` can never gate on and act over
    // different selections. Mode/gesture come from the interaction store.
    return deriveContextKeys(
      { ...this.interactionStore.value, selectedKeys: [...this.selectedKeys] },
      {
        readonly: this.readonly,
        viewLayer: this.layout?.kind ?? "diagram",
        hasClipboard: this.hasClipboard,
        vertexTarget: this.contextVertex !== null,
        polySelection: this.singlePolyShapeSelected(),
      },
    );
  }

  /** Run a command by id; returns whether it was enabled and fired. */
  private runCommand(id: DiagramCommandId): boolean {
    return this.commands.run(id, this.commandContext(), this.commandTarget());
  }

  /**
   * Run a diagram command pushed from the host (a VSCode keybinding routed
   * through the extension). The command's own `when` gate still applies, so an
   * id that isn't valid for the current selection is a no-op.
   */
  runCommandById(id: DiagramCommandId): boolean {
    return this.runCommand(id);
  }

  /**
   * Adjust the selection a right-click acts on, so the menu always targets
   * what was actually clicked: right-clicking an unselected entity selects it,
   * right-clicking an already-selected one keeps the (possibly multi-)
   * selection, and right-clicking empty space clears it.
   */
  private selectForContext(key: string | null): void {
    const next = nextContextSelection(this.selectedKeys, key);
    if (next !== null) {
      this.setSelection(next);
    }
  }

  /** Open the context menu at the cursor with the commands valid right now. */
  private openContextMenu(x: number, y: number): void {
    const menu = this.contextMenuEl;
    if (!menu) {
      return;
    }
    const ctx = this.commandContext();
    const items = commandsToMenuItems(
      this.commands.commandsFor("contextMenu", ctx),
    );
    if (items.length === 0) {
      return;
    }
    // Anchor to the diagram point under the cursor so the menu tracks that spot
    // through pan/zoom (reprojected on `om-view-change`).
    this.contextMenuAnchor = this.sceneEl?.clientToDiagram(x, y) ?? null;
    menu.items = items;
    menu.open(x, y);
  }

  private readonly onViewChange = (): void => {
    if (!this.contextMenuAnchor || !this.contextMenuEl) {
      return;
    }
    const pt = this.sceneEl?.diagramToClient(
      this.contextMenuAnchor.x,
      this.contextMenuAnchor.y,
    );
    if (pt) {
      this.contextMenuEl.moveTo(pt.x, pt.y);
    }
  };

  private readonly onContextMenuClose = (): void => {
    this.contextMenuAnchor = null;
    this.contextVertex = null;
  };

  private readonly onContextMenuSelect = (
    e: CustomEvent<ContextMenuSelectDetail>,
  ): void => {
    // The id came from `commandsFor`, so it's a registered command; resolve it
    // back through `all()` to recover the typed id without a cast.
    const command = this.commands.all().find((c) => c.id === e.detail.id);
    if (command) {
      this.commands.run(
        command.id,
        this.commandContext(),
        this.commandTarget(),
      );
    }
  };

  private emit<K extends LayoutEventName>(
    name: K,
    detail: LayoutEvents[K],
  ): void {
    emitEvent(this, name, detail);
  }

  /** Returns the current selection as an array of canonical keys. */
  get selection(): string[] {
    return Array.from(this.selectedKeys);
  }

  /**
   * Convenience for callers that want to drive selection externally. Emits
   * like the pointer paths do: the host mirrors the selection to gate its own
   * affordances, so a silent write would leave those stale — the action panel
   * disabled over the components a paste just selected, for instance.
   */
  setSelection(keys: Iterable<string>): void {
    this.selectedKeys = new Set(
      Array.from(keys).filter((k) => parseKey(k) !== null),
    );
    const next = Array.from(this.selectedKeys);
    this.emit("om-selection-change", { keys: next });
    this.interactionStore.next({ selectedKeys: next });
  }

  /** Read-only access to the live interaction state. Useful for tests
   *  and external observers that want a snapshot without subscribing. */
  get interactionState(): InteractionState {
    return this.interactionStore.value.state;
  }

  /**
   * Rotate the current selection by ±90° around each entity's centre.
   * Mirrors the `r` / `Shift+r` keybinding so external affordances (the
   * action panel's rotate button) drive the same mutation. No-op when
   * read-only or nothing is selected.
   */
  rotateSelection(cw = true): void {
    this.runCommand(cw ? "diagram.rotateCw" : "diagram.rotateCcw");
  }

  /**
   * Mirror the current selection horizontally or vertically. Mirrors the
   * `f` / `Shift+f` keybinding. No-op when read-only or nothing is
   * selected.
   */
  flipSelection(horizontal = true): void {
    this.runCommand(
      horizontal ? "diagram.flipHorizontal" : "diagram.flipVertical",
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-graphical-layout": OmGraphicalLayout;
  }
}
