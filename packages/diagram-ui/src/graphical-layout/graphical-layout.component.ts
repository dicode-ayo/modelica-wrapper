import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  ComponentInstance,
  ConnectorInstance,
  DiagramLayout,
} from "@modelica-wrapper/omc-client";

import "../icon-provider/icon-provider.component.js";
import "../scene/scene.component.js";
import "../axis/grid-axis.component.js";
import "../component/component.component.js";
import "../connector/connector.component.js";
import "../connection/connection.component.js";
import "../label/label.component.js";
import "../connection/edge.component.js";
import "../debug/perf-hud.component.js";
import "../library-browser/library-browser.component.js";
import type { OmScene, EngineFactory } from "../scene/scene.component.js";
import type { RasterizeFn, SvgRenderFn } from "../icon-provider/icon-cache.js";
import type { LibraryBrowserDataSource } from "../library-browser/library-browser.component.js";
import {
  InteractionManager,
  defaultPicker,
  type InteractionEvents,
  type PickerFn,
} from "../interaction/interaction-manager.js";
import {
  DragController,
  type DragEvents,
} from "../interaction/drag-controller.js";
import {
  applyDeltaMove,
  applyDelete,
  applyFlip,
  applyRotate,
  selectByDiagramRect,
} from "../interaction/layout-ops.js";
import { formatKey, parseKey } from "../interaction/node-keys.js";

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
    placement: import("@modelica-wrapper/omc-client").Placement,
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
 *   <om-icon-provider>
 *     <om-scene>
 *       <om-grid-axis>
 *       <om-component>...<om-connector>     # nested ports
 *       <om-connector>                       # host-level ports
 *       <om-connection>                      # routed edges + junctions
 *       <om-label>                           # host-level text
 *     </om-scene>
 *   </om-icon-provider>
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
 *   - `om-connection-create`       { detail: { fromKey, toKey } }
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

  /** Optional SVG renderer override forwarded to `<om-icon-provider>`. */
  @property({ attribute: false })
  renderSvg: SvgRenderFn | undefined = undefined;

  /** Optional rasteriser override forwarded to `<om-icon-provider>`. */
  @property({ attribute: false })
  rasterize: RasterizeFn | undefined = undefined;

  /** Forwarded to `<om-scene>`: opens Babylon's Inspector + enables
   *  verbose rasteriser logging when `true`. */
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
   * Stroke-width multiplier forwarded to every entity's SVG renderer
   * (overlay path) AND to `<om-icon-provider>` (in-canvas textured
   * plane). `undefined` falls back to the renderer's default — see
   * `RenderOptions.lineThicknessScale` for the rationale.
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

  @state() private selectedKeys: Set<string> = new Set();
  @state() private draftLayout: DiagramLayout | null = null;
  @state() private hoverKey: string | null = null;
  @state() private inProgressConnection: {
    from: string;
    to: { x: number; y: number };
    toKey: string | null;
  } | null = null;
  @state() private libraryBrowserOpen = false;

  @query("om-scene") private sceneEl?: OmScene;

  private interactionManager: InteractionManager | null = null;
  private dragController: DragController | null = null;
  private dblClickPicker: PickerFn | null = null;
  private dblClickCanvas: HTMLCanvasElement | null = null;

  override render(): TemplateResult {
    const active = this.draftLayout ?? this.layout;
    if (!active) {
      return html``;
    }
    const componentEntries = Object.entries(active.components);
    const connectorEntries = Object.entries(active.connectors);
    // Topology: scene OUTSIDE, icon-provider INSIDE. Lit contexts only
    // flow down, so the icon-provider has to be a descendant of the
    // scene to `@consume(sceneContext)`. The reverse (icon-provider as
    // wrapper) leaves the provider unable to see the scene and every
    // textureFor* call rejects with "icon-provider not connected to
    // a scene" — that was the real reason every icon rendered as the
    // fallback colour.
    return html`
      <om-scene
        .engineFactory=${this.engineFactory ?? undefined}
        ?debug=${this.debug}
        camera-mode=${this.cameraMode}
        @om-view-change=${this.onViewChange}
        tabindex="0"
        @keydown=${this.onKeyDown}
      >
        <om-icon-provider
          .renderSvg=${this.renderSvg ?? undefined}
          .rasterize=${this.rasterize ?? undefined}
          .lineThicknessScale=${this.lineThicknessScale}
        >
          <om-grid-axis
            .extent=${500}
            .coordinateSystem=${active.coordinateSystem ?? undefined}
          ></om-grid-axis>
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
          ${this.renderInProgressEdge()}
          <om-perf-hud ?show=${this.perfHud}></om-perf-hud>
        </om-icon-provider>
      </om-scene>
      ${this.libraryBrowserOpen
        ? html`<om-library-browser
            open
            .dataSource=${this.libraryDataSource}
            @om-library-select=${this.onLibrarySelect}
            @om-library-cancel=${this.onLibraryCancel}
          ></om-library-browser>`
        : nothing}
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
        this.selectedKeys = new Set();
      }
      this.internalLayoutChange = false;
    }
    if (
      !this.interactionManager &&
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
    const key = formatKey("component", id);
    return html`<om-component
      .nodeId=${id}
      .placement=${comp.placement}
      .layers=${cls?.iconLayers ?? []}
      .coordinateSystem=${cls?.coordinateSystem ?? undefined}
      .lineThicknessScale=${this.lineThicknessScale}
      ?selected=${this.selectedKeys.has(key)}
      ?readonly=${this.readonly}
    >
      ${cls
        ? Object.entries(cls.connectors).map(
            ([pid, port]) => html`<om-connector
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
    const key = formatKey("connector", id);
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

  private renderInProgressEdge(): TemplateResult | typeof nothing {
    const ip = this.inProgressConnection;
    if (!ip) {
      return nothing;
    }
    // Start point: we don't have the connector's diagram position here
    // without walking the layout; use the to-point as a placeholder
    // marker so the user sees the drag is active. F1's job is the wire
    // — endpoint snapping refinement happens upstream.
    return html`<om-edge
      .nodeId=${"in-progress"}
      .path=${[
        [ip.to.x, ip.to.y],
        [ip.to.x, ip.to.y],
      ]}
      .stroke=${"#3b82f6"}
    ></om-edge>`;
  }

  private attachManagers(): void {
    if (this.interactionManager) {
      return;
    }
    const sceneEl = this.sceneEl;
    const ctx = sceneEl?.sceneContextValue;
    const canvas = sceneEl?.canvasElement;
    if (!ctx || !canvas) {
      return;
    }
    const picker = defaultPicker(ctx.scene, canvas);
    this.interactionManager = new InteractionManager(canvas, picker, (type, detail) =>
      this.onInteraction(type, detail),
    );
    this.dragController = new DragController(
      canvas,
      picker,
      (cx, cy) => sceneEl!.clientToDiagram(cx, cy),
      () => Array.from(this.selectedKeys),
      (type, detail) => this.onDrag(type, detail),
    );
    // Native dblclick on empty canvas → open the library browser.
    // InteractionManager's `doubleClick` only fires on hits; this path
    // catches the empty-space case without changing its contract.
    this.dblClickPicker = picker;
    this.dblClickCanvas = canvas;
    canvas.addEventListener("dblclick", this.onCanvasDblClick);
  }

  private detachManagers(): void {
    this.interactionManager?.destroy();
    this.dragController?.destroy();
    this.interactionManager = null;
    this.dragController = null;
    if (this.dblClickCanvas) {
      this.dblClickCanvas.removeEventListener("dblclick", this.onCanvasDblClick);
      this.dblClickCanvas = null;
    }
    this.dblClickPicker = null;
  }

  private onCanvasDblClick = (e: MouseEvent): void => {
    if (this.readonly || !this.libraryDataSource || !this.dblClickPicker) {
      return;
    }
    // Only open on empty-canvas double-clicks — double-clicking a
    // component is the "open parameters" gesture handled separately
    // through InteractionManager's doubleClick event.
    if (this.dblClickPicker(e.clientX, e.clientY) !== null) {
      return;
    }
    this.libraryBrowserOpen = true;
  };

  private onLibrarySelect = (
    e: CustomEvent<{ className: string }>,
  ): void => {
    e.stopPropagation();
    const className = e.detail.className;
    this.libraryBrowserOpen = false;
    // Place the new component at the current view centre. The pan
    // coordinates are already in diagram space — the camera target
    // is what's centred in the viewport.
    const sceneEl = this.sceneEl;
    const position = sceneEl
      ? { x: sceneEl.panX, y: sceneEl.panY }
      : { x: 0, y: 0 };
    this.emit("om-add-component-request", { className, position });
  };

  private onLibraryCancel = (e: Event): void => {
    e.stopPropagation();
    this.libraryBrowserOpen = false;
  };

  private onViewChange = (_e: Event): void => {
    // Future hooks (fit-to-view, etc.); currently a no-op.
  };

  private onInteraction<K extends keyof InteractionEvents>(
    type: K,
    detail: InteractionEvents[K],
  ): void {
    switch (type) {
      case "hover": {
        const d = detail as InteractionEvents["hover"];
        if (this.hoverKey !== d.key) {
          this.hoverKey = d.key;
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
        const updated = applyDeltaMove(this.layout, d.keys, d.dx, d.dy);
        if (d.draft) {
          this.draftLayout = updated;
        } else {
          this.commitLayout(updated);
        }
        return;
      }
      case "rubberBand": {
        const d = detail as DragEvents["rubberBand"];
        if (d.draft) {
          // Live selection preview.
          this.selectedKeys = selectByDiagramRect(this.layout, d.rect);
        } else {
          const keys = selectByDiagramRect(this.layout, d.rect);
          this.selectedKeys = keys;
          this.emit("om-selection-change", { keys: Array.from(keys) });
        }
        return;
      }
      case "connection": {
        const d = detail as DragEvents["connection"];
        if (!d.commit) {
          this.inProgressConnection = {
            from: d.from,
            to: d.to,
            toKey: d.toKey,
          };
        } else {
          this.inProgressConnection = null;
          if (d.toKey) {
            this.emit("om-connection-create", {
              fromKey: d.from,
              toKey: d.toKey,
            });
          }
        }
        return;
      }
      case "resize":
        // Resize commit emits a request for an absolute extent — the
        // host should compute that via applyComponentExtent. v1 just
        // forwards the event so callers can wire in custom logic
        // (e.g. snap-to-grid before committing).
        this.emit("om-resize", detail as DragEvents["resize"]);
        return;
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
    if (this.readonly || !this.layout || this.selectedKeys.size === 0) {
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      const updated = applyDelete(this.layout, this.selectedKeys);
      if (updated !== this.layout) {
        this.commitLayout(updated);
        this.selectedKeys = new Set();
        e.preventDefault();
      }
      return;
    }
    if (e.key === "r" || e.key === "R") {
      const updated = applyRotate(this.layout, this.selectedKeys, !e.shiftKey);
      if (updated !== this.layout) {
        this.commitLayout(updated);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "f" || e.key === "F") {
      const updated = applyFlip(this.layout, this.selectedKeys, !e.shiftKey);
      if (updated !== this.layout) {
        this.commitLayout(updated);
        e.preventDefault();
      }
    }
  };

  private emit<T>(name: string, detail: T): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
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
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-graphical-layout": OmGraphicalLayout;
  }
}
