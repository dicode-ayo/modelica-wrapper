import type { Node } from "@babylonjs/core";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import { repeat } from "lit/directives/repeat.js";
import type {
  ComponentInstance,
  ConnectorInstance,
  DiagramLayout,
} from "@dicode/omc-client";

import { renderLayers } from "../primitives/render-shape.js";
import { buildSubstitutions } from "../label/build-substitutions.js";
import "../scene/scene.component.js";
import "../axis/grid-axis.component.js";
import "../component/component.component.js";
import "../connector/connector.component.js";
import "../connection/connection.component.js";
import "../label/label.component.js";
import "../debug/perf-hud.component.js";
import "../library-browser/library-browser.component.js";
import "../context-menu/context-menu.component.js";
import type { OmScene, EngineFactory } from "../scene/scene.component.js";
import type { OmConnector } from "../connector/connector.component.js";
import type { OmComponent } from "../component/component.component.js";
import type { LibraryBrowserDataSource } from "../library-browser/library-browser.component.js";
import {
  defaultPicker,
  type InteractionEvents,
  type PickerFn,
  type PickerFactory,
} from "../interaction/interaction-manager.js";
import type { DragEvents } from "../interaction/gesture-mode.js";
import { ModeRouter } from "../interaction/mode.js";
import {
  applyDeltaMove,
  applyEdgeSegmentDrag,
  applyResize,
  applyRotation,
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
import {
  deriveContextKeys,
  type ContextKeys,
} from "../interaction/context-keys.js";
import {
  entityKeyForNode,
  formatComponentKey,
  formatConnectorKey,
  isComponentKey,
  isConnectorKey,
  isEdgeKey,
  isJunctionKey,
  parseKey,
} from "../interaction/node-keys.js";
import type { LibraryEvents } from "../library-browser/library-browser.component.js";
import { orthogonalRoute } from "../interaction/connection-route.js";
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
import type { LayoutEventName, LayoutEvents } from "./layout-events.js";

/**
 * World-z offset applied to the host class's own shapes so they sit
 * behind every component / connector but IN FRONT of the grid's
 * extent-rectangle (the white drawing-area plane). Stacking, camera
 * at -Z so larger z = farther:
 *
 *   extent-rect  z = +0.10  (white background, drawn by `<om-grid-axis>`)
 *   grid lines   z = +0.05
 *   host shapes  z = +0.025 ← us
 *   components   z =  0.0   (default `OmShapeNode` placement)
 *
 * A value at +0.5 (the original guess) put host shapes well behind
 * the extent-rect — visible in scene.meshes but never painted because
 * the white plane occluded them on every frame.
 */
const HOST_SHAPE_Z_BIAS = 0.025;

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
 *       — fired after the user picks a class from the library-browser
 *         overlay (double-click on empty canvas). The host wires this
 *         to `addComponent(...)` + a layout refresh.
 */
@customElement("om-graphical-layout")
export class OmGraphicalLayout extends LitElement {
  static override styles = css`
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
  `;

  @property({ attribute: false })
  layout: DiagramLayout | null = null;

  @property({ type: Boolean, reflect: true })
  readonly = false;

  /** Optional engine factory forwarded to the inner `<om-scene>`. Used
   *  by tests to inject a `NullEngine`. */
  @property({ attribute: false })
  engineFactory: EngineFactory | undefined = undefined;

  /** Optional picker factory. Defaults to `defaultPicker` (scene raycast);
   *  tests inject a deterministic picker so pointer gestures resolve to
   *  known entities without a live render. */
  @property({ attribute: false })
  pickerFactory: PickerFactory | undefined = undefined;

  /** Forwarded to `<om-scene>`: opens Babylon's Inspector when `true`. */
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
   * Stroke-width multiplier forwarded to every entity. Currently a
   * no-op under the primitives renderer (line widths come straight
   * from Modelica annotations); kept on the public API for forward-
   * compat with hosts that already set it.
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
   * Data source for the library-browser overlay opened by double-
   * clicking empty canvas. When `null` (default), double-clicks on
   * empty space are ignored — the embedder opts into the feature by
   * supplying a source backed by `getClassNames` / a search index.
   */
  @property({ attribute: false })
  libraryDataSource: LibraryBrowserDataSource | null = null;

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
  @state() private libraryBrowserOpen = false;

  @query("om-scene") private sceneEl?: OmScene;
  @query("om-context-menu") private contextMenuEl?: OmContextMenu;

  /** Diagram-space point the open context menu is anchored to (so it tracks
   *  that spot through pan/zoom). Null when the menu is closed. */
  private contextMenuAnchor: { x: number; y: number } | null = null;

  private modeRouter: ModeRouter | null = null;
  private dblClickPicker: PickerFn | null = null;
  private dblClickCanvas: HTMLCanvasElement | null = null;
  /**
   * Diagram-space position captured at the moment the user double-
   * clicked empty canvas. Used as the drop point for whichever class
   * they pick in the library browser; falls back to the view centre
   * if `clientToDiagram` returns null (canvas not yet sized).
   */
  private pendingAddPosition: { x: number; y: number } | null = null;

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
   * The diagram command set + its key bindings. One registry backs both the
   * keymap dispatch (`onKeyDown`) and the public action methods the
   * action-panel buttons drive, so a shortcut and its button can't diverge.
   */
  private readonly commands = new CommandRegistry(DIAGRAM_COMMANDS);
  private readonly keymap = DEFAULT_KEYMAP;

  constructor() {
    super();
    new ContextProvider(this, {
      context: interactionStateContext,
      initialValue: this.interactionStore,
    });
  }

  override render(): TemplateResult {
    const active = this.draftLayout ?? this.layout;
    if (!active) {
      return html``;
    }
    const componentEntries = Object.entries(active.components);
    const connectorEntries = Object.entries(active.connectors);
    return html`
      <om-scene
        @om-view-change=${this.onViewChange}
        .engineFactory=${this.engineFactory ?? undefined}
        ?debug=${this.debug}
        camera-mode=${this.cameraMode}
        tabindex="0"
        @keydown=${this.onKeyDown}
      >
        <om-grid-axis
          .extent=${500}
          .coordinateSystem=${active.coordinateSystem ?? undefined}
        ></om-grid-axis>
        ${this.renderHostShapes(active)}
        ${repeat(
          componentEntries,
          ([id]) => id,
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
              .path=${conn.waypoints}
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
      ${this.libraryBrowserOpen
        ? html`<om-library-browser
            open
            .dataSource=${this.libraryDataSource}
            @om-library-select=${this.onLibrarySelect}
            @om-library-cancel=${this.onLibraryCancel}
          ></om-library-browser>`
        : nothing}
      <om-context-menu
        @om-context-menu-select=${this.onContextMenuSelect}
        @om-context-menu-close=${this.onContextMenuClose}
      ></om-context-menu>
    `;
  }

  override async firstUpdated(): Promise<void> {
    // Lit schedules child element updates *after* the parent's, so
    // when this fires the inner <om-scene> has been rendered into
    // our shadow DOM but its own `firstUpdated()` (where it mounts
    // the Babylon engine + provides the scene context) hasn't run
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

  /**
   * Render the host class's own shapes — the diagram-level visuals it
   * authored. For a PID controller class, this is typically a labelled
   * background rectangle plus annotations that frame the sub-component
   * layout. Sat behind the components with a positive z-bias so the
   * depth test puts them in the back layer; the camera lives at -Z, so
   * positive z is away from the viewer.
   *
   * `kind` picks the layer set: `"diagram"` shows `diagramLayers`,
   * `"icon"` shows `iconLayers`. The two are mutually exclusive in
   * practice — the producer fills the one that matches the requested
   * view.
   */
  private renderHostShapes(layout: DiagramLayout): TemplateResult[] {
    const layers =
      layout.kind === "icon" ? layout.iconLayers : layout.diagramLayers;
    return renderLayers(layers, HOST_SHAPE_Z_BIAS);
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
    const picker = (this.pickerFactory ?? defaultPicker)(ctx.scene, canvas);
    this.modeRouter = new ModeRouter({
      canvas,
      picker,
      clientToDiagram: (cx, cy) => sceneEl.clientToDiagram(cx, cy),
      getSelectionKeys: () => Array.from(this.selectedKeys),
      onInteraction: (type, detail) => this.onInteraction(type, detail),
      onDrag: (type, detail) => this.onDrag(type, detail),
      store: this.interactionStore,
      scene: ctx.scene,
      overlayParent: ctx.diagramRoot,
      connectorPosition: (key) => this.connectorDiagramPosition(key),
      evaluateCompat: (from, toKey) => this.evaluateCompat(from, toKey),
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
    const node = this.dblClickPicker(e.clientX, e.clientY);
    // Double-clicking a connection edits its route: a hit on the edge
    // line inserts a waypoint at the click; a hit on a junction disc
    // deletes that waypoint.
    if (node && this.handleWaypointDblClick(node, e)) {
      return;
    }
    if (!this.libraryDataSource) {
      return;
    }
    // Only open on empty-canvas double-clicks — double-clicking a
    // component is the "open parameters" gesture handled separately
    // through InteractionManager's doubleClick event.
    if (node !== null) {
      return;
    }
    // Capture the diagram-space click position now: by the time the
    // user picks a class in the library browser, the mouse may have
    // moved arbitrarily and the original location is gone.
    this.pendingAddPosition =
      this.sceneEl?.clientToDiagram(e.clientX, e.clientY) ?? null;
    this.libraryBrowserOpen = true;
  };

  /**
   * Resolve a double-click on a connection's edge / junction into a
   * waypoint insert / delete and commit it. Returns `true` when the
   * gesture was consumed (so the library-browser path is skipped),
   * `false` when the picked node isn't a connection.
   */
  private handleWaypointDblClick(node: Node, e: MouseEvent): boolean {
    if (!this.layout) {
      return false;
    }
    const entity = entityKeyForNode(node);
    if (!entity) {
      return false;
    }
    if (isEdgeKey(entity)) {
      // Edge nodeId is the connection index.
      const connIdx = Number(entity.nodeId);
      const point = this.sceneEl?.clientToDiagram(e.clientX, e.clientY);
      if (Number.isNaN(connIdx) || !point) {
        return false;
      }
      this.commitLayout(applyWaypointInsert(this.layout, connIdx, point));
      return true;
    }
    if (isJunctionKey(entity)) {
      // Junction nodeId is the compound `<connIdx>/<waypointIdx>`.
      const slash = entity.nodeId.indexOf("/");
      if (slash < 0) {
        return false;
      }
      const connIdx = Number(entity.nodeId.slice(0, slash));
      const waypointIdx = Number(entity.nodeId.slice(slash + 1));
      if (Number.isNaN(connIdx) || Number.isNaN(waypointIdx)) {
        return false;
      }
      this.commitLayout(applyWaypointDelete(this.layout, connIdx, waypointIdx));
      return true;
    }
    return false;
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
    return applyWaypointDrag(layout, connIdx, waypointIdx, dx, dy);
  }

  private onLibrarySelect = (
    e: CustomEvent<LibraryEvents["om-library-select"]>,
  ): void => {
    e.stopPropagation();
    const className = e.detail.className;
    this.libraryBrowserOpen = false;
    // Prefer the diagram-space position captured at double-click
    // time. Fall back to the current view centre if the capture
    // failed (e.g. canvas wasn't sized yet). View centre is fine as
    // a backstop because at least it lands in something the user
    // can see — not arbitrary world origin.
    const sceneEl = this.sceneEl;
    const raw =
      this.pendingAddPosition ??
      (sceneEl ? { x: sceneEl.panX, y: sceneEl.panY } : { x: 0, y: 0 });
    this.pendingAddPosition = null;
    // Snap the drop point to the active grid so the new component
    // lands on a grid intersection — same rule the drag handler
    // applies, so subsequent moves don't visibly "correct" the
    // position on first interaction.
    const position = snapPoint(raw.x, raw.y, this.currentSnapGrid());
    this.emit("om-add-component-request", { className, position });
  };

  private onLibraryCancel = (
    e: CustomEvent<LibraryEvents["om-library-cancel"]>,
  ): void => {
    e.stopPropagation();
    this.libraryBrowserOpen = false;
    this.pendingAddPosition = null;
  };

  private onInteraction<K extends keyof InteractionEvents>(
    type: K,
    detail: InteractionEvents[K],
  ): void {
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
        this.selectForContext(d.key);
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

  /**
   * Single entry point for state transitions driven by `DragController`.
   * Centralised so a future test can assert the machine's behaviour
   * against a sequence of events without re-wiring the whole host.
   */
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
    if (this.readonly || !this.layout) {
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
          this.layout,
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
    const id = this.keymap.get(chordFromEvent(e));
    if (id && this.runCommand(id)) {
      e.preventDefault();
    }
  };

  /** The diagram surface a command mutates — an adapter over this element. */
  private commandTarget(): CommandTarget {
    return {
      layout: this.layout,
      selectedKeys: this.selectedKeys,
      commitLayout: (next) => this.commitLayout(next),
      setSelection: (keys) => this.setSelection(keys),
    };
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
        hasClipboard: false,
      },
    );
  }

  /** Run a command by id; returns whether it was enabled and fired. */
  private runCommand(id: DiagramCommandId): boolean {
    return this.commands.run(id, this.commandContext(), this.commandTarget());
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
    this.dispatchEvent(
      new CustomEvent<LayoutEvents[K]>(name, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Returns the current selection as an array of canonical keys. */
  get selection(): string[] {
    return Array.from(this.selectedKeys);
  }

  /** Convenience for callers that want to drive selection externally. */
  setSelection(keys: Iterable<string>): void {
    this.selectedKeys = new Set(
      Array.from(keys).filter((k) => parseKey(k) !== null),
    );
    this.interactionStore.next({
      selectedKeys: Array.from(this.selectedKeys),
    });
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
