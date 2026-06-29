import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { ContextProvider } from "@lit/context";
import {
  autoDetectRenderer,
  Container,
  Point,
  type Matrix,
  type Renderer,
} from "pixi.js";

import { parentNodeContext } from "../base/parent-node-context.js";
import { sceneContext, type SceneContext } from "./scene-context.js";
import { ViewStateStore, viewStateContext } from "./view-state-store.js";
import {
  registerRenderScheduler,
  requestSceneRender,
  unregisterRenderScheduler,
} from "./render-scheduler.js";
import {
  DEFAULT_EXTENT_HALF,
  FALLBACK_CANVAS_HEIGHT,
  FALLBACK_CANVAS_WIDTH,
} from "../constants.js";
import { PanZoom } from "./pan-zoom.js";
import {
  clientToDiagram as computeClientToDiagram,
  diagramToClient as computeDiagramToClient,
  type ViewState,
} from "./view-math.js";
import { setRasterizerDebug } from "../icon-provider/svg-rasterizer.js";

/** Scene background, matching the `:host` CSS plate (#f7f7f8). */
const SCENE_BACKGROUND = 0xf7f7f8;

/**
 * Factory injected by tests so the scene can mount without a GPU
 * context: returning `null` builds the Pixi scene graph (Containers,
 * Graphics) on the CPU with no renderer, which is all the unit suite
 * asserts on. In production the default factory creates a real WebGL
 * `Renderer` against the canvas element.
 */
export type RendererFactory = (
  canvas: HTMLCanvasElement,
  size: { width: number; height: number; resolution: number },
) => Renderer | null | Promise<Renderer | null>;

const defaultRendererFactory: RendererFactory = (canvas, size) =>
  // `preference: 'webgl'` keeps the renderer off WebGPU, which is absent
  // or unreliable under the software stack (SwiftShader) used when
  // hardware acceleration is off. `autoDensity: false` leaves the
  // canvas display size to the `:host` CSS (`width/height: 100%`) while
  // the backing store is sized in physical pixels via `resolution` so
  // 1-px strokes and small handles stay crisp on HiDPI displays.
  autoDetectRenderer({
    preference: "webgl",
    canvas,
    width: size.width,
    height: size.height,
    resolution: size.resolution,
    autoDensity: false,
    antialias: true,
    background: SCENE_BACKGROUND,
    clearBeforeRender: true,
  });

/**
 * `<om-scene>` — root custom element for the graphical layout editor.
 *
 * Creates a Pixi WebGL renderer and a `Container` tree on `firstUpdated`
 * and exposes three Lit contexts:
 *
 *  - `sceneContext`: renderer + container roots + `pick`/`requestRender`
 *    for ad-hoc operations (picking, overlays, fit-to-view math).
 *  - `parentNodeContext`: the `diagramRoot` `Container` that entity
 *    elements (`<om-component>`, ...) attach to. Children walk upward
 *    via Lit context, not via direct renderer references.
 *  - `viewStateContext`: the reactive pan/zoom store consumed by HTML
 *    overlays.
 *
 * Coordinate convention:
 *   diagram (x, y) maps to CSS pixels via `worldRoot`'s transform (the
 *   pan/zoom anchor; `diagramRoot` is its identity child whose local
 *   space is therefore diagram coordinates):
 *     ppu = renderHeight / (2 * zoom)
 *     worldRoot.scale    = (ppu, -ppu)   // -y flips canvas +y-down to
 *                                        //   Modelica +y-up
 *     worldRoot.position = (W/2 - panX*ppu, H/2 + panY*ppu)
 *   so world +x is screen right and world +y is screen up. Geometry
 *   (fills/strokes/polylines) is built in raw diagram coordinates; text
 *   and raster sprites apply a local `scale.y = -1` to stay upright
 *   under the flip.
 */
@customElement("om-scene")
export class OmScene extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      background: var(--om-scene-background, #f7f7f8);
      /*
       * Slotted HTML overlays (om-icon-overlay) are positioned absolute
       * with translate() transforms driven by pan/zoom. Without
       * overflow:hidden they extend past the host bounds during motion,
       * which makes the page scrollbars oscillate on/off. Clipping here
       * keeps the canvas size stable.
       */
      overflow: hidden;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      outline: none;
    }
  `;

  /**
   * Renderer factory override. Tests pass a factory returning `null` so
   * the scene mounts without a WebGL context. Setting this after mount
   * has no effect. `undefined` falls back to the real-WebGL default.
   */
  @property({ attribute: false })
  rendererFactory: RendererFactory | undefined = undefined;

  /**
   * Diagram half-height currently shown (in diagram units). With the
   * canvas aspect ratio it fills in the `diagramRoot` transform.
   */
  @property({ type: Number, reflect: true })
  zoom: number = DEFAULT_EXTENT_HALF;

  /** View centre X offset (in diagram units). */
  @property({ type: Number, reflect: true, attribute: "pan-x" })
  panX = 0;

  /** View centre Y offset (in diagram units). */
  @property({ type: Number, reflect: true, attribute: "pan-y" })
  panY = 0;

  /**
   * Camera projection mode. `"2d"` (default) is the orthographic diagram
   * editor. `"3d"` is reserved for the not-yet-implemented MultiBody
   * view; the 2D Pixi renderer treats it as a no-op.
   */
  @property({ type: String, reflect: true, attribute: "camera-mode" })
  cameraMode: "2d" | "3d" = "2d";

  /** Enables verbose logging in the icon-provider rasteriser. */
  @property({ type: Boolean, reflect: true })
  debug = false;

  private readonly canvasRef = createRef<HTMLCanvasElement>();
  private readonly resizeObserver = new ResizeObserver(() =>
    this.handleResize(),
  );

  private renderer: Renderer | null = null;
  private stage: Container | null = null;
  private worldRoot: Container | null = null;
  private diagramRoot: Container | null = null;
  private panZoom: PanZoom | null = null;
  private schedulerRegistered = false;
  /** Guards async teardown that lands after a renderer init started. */
  private disposed = false;
  private updatingFromUser = false;

  private readonly sceneProvider = new ContextProvider(this, {
    context: sceneContext,
    initialValue: null,
  });

  private readonly parentNodeProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  private readonly viewStateStore = new ViewStateStore({
    zoom: this.zoom,
    panX: this.panX,
    panY: this.panY,
  });
  private readonly viewStateProvider = new ContextProvider(this, {
    context: viewStateContext,
    initialValue: this.viewStateStore,
  });

  override render() {
    return html`<canvas ${ref(this.canvasRef)} tabindex="0"></canvas
      ><slot></slot>`;
  }

  override firstUpdated(): void {
    const canvas = this.canvasRef.value;
    if (!canvas) {
      return;
    }
    this.mount(canvas);
  }

  override updated(changed: Map<string, unknown>): void {
    if (!this.diagramRoot || this.updatingFromUser) {
      return;
    }
    if (changed.has("zoom") || changed.has("panX") || changed.has("panY")) {
      this.applyView();
    }
    if (changed.has("debug")) {
      setRasterizerDebug(this.debug);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unmount();
  }

  /**
   * Returns the live `SceneContext`, or `null` if the element has not
   * yet finished mounting (or has been torn down). Exposed for tests
   * and siblings that need ad-hoc scene access.
   */
  get sceneContextValue(): SceneContext | null {
    return this.sceneProvider.value;
  }

  /** Exposes the internal `<canvas>` for siblings that attach pointer
   *  listeners (e.g. the interaction manager). */
  get canvasElement(): HTMLCanvasElement | null {
    return this.canvasRef.value ?? null;
  }

  private mount(canvas: HTMLCanvasElement): void {
    // Build the scene-graph roots synchronously so the context is usable
    // immediately — entities (and renderer-less tests) attach to
    // diagramRoot without waiting on the async GPU init below.
    const stage = new Container({ label: "om-stage" });
    stage.eventMode = "passive";
    const worldRoot = new Container({ label: "om-world" });
    worldRoot.eventMode = "passive";
    // No depth buffer in 2D — paint order is child order. zIndex +
    // sortableChildren let the grid sit behind entities and entities
    // layer their own fills/strokes/edges.
    worldRoot.sortableChildren = true;
    const diagramRoot = new Container({ label: "om-diagram" });
    diagramRoot.eventMode = "passive";
    diagramRoot.sortableChildren = true;
    worldRoot.addChild(diagramRoot);
    stage.addChild(worldRoot);

    this.stage = stage;
    this.worldRoot = worldRoot;
    this.diagramRoot = diagramRoot;

    const ctx: SceneContext = {
      renderer: null,
      stage,
      worldRoot,
      diagramRoot,
      pick: (x, y) => this.pick(x, y),
      worldPerPixel: () => this.worldPerPixel(),
      requestRender: () => requestSceneRender(stage),
    };
    this.sceneProvider.setValue(ctx);
    this.parentNodeProvider.setValue(diagramRoot);

    this.applyView();

    this.panZoom = new PanZoom(
      canvas,
      () => ({ zoom: this.zoom, panX: this.panX, panY: this.panY }),
      (next) => this.onViewChangeFromUser(next),
    );
    this.resizeObserver.observe(this);
    setRasterizerDebug(this.debug);

    void this.initRenderer(canvas, ctx);
  }

  private async initRenderer(
    canvas: HTMLCanvasElement,
    ctx: SceneContext,
  ): Promise<void> {
    const factory = this.rendererFactory ?? defaultRendererFactory;
    const { width, height } = this.cssSize();
    const resolution =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const renderer = await factory(canvas, { width, height, resolution });
    // The element may have been torn down while the renderer was
    // initialising (rapid remount / hot reload) — drop the stale one.
    if (this.disposed || this.stage !== ctx.stage) {
      renderer?.destroy();
      return;
    }
    if (!renderer) {
      return;
    }
    this.renderer = renderer;
    ctx.renderer = renderer;

    // On-demand rendering: register a scheduler keyed by the stage so
    // mutation sites call `ctx.requestRender()` and coalesce repaints
    // into a single rAF. Idle frames cost 0 — critical under
    // software-rendered WebGL where a continuous loop saturates the CPU.
    registerRenderScheduler(ctx.stage, () => {
      if (this.renderer && this.stage) {
        this.renderer.render(this.stage);
      }
    });
    this.schedulerRegistered = true;

    this.handleResize();
    // The renderer arrives a frame or two after the synchronous mount
    // that first provided the context. Re-emit so consumers that gate on
    // a live renderer (labels measure Pixi Text through a real canvas)
    // build now that it exists.
    this.sceneProvider.setValue({ ...ctx });
    requestSceneRender(ctx.stage);
  }

  private cssSize(): { width: number; height: number } {
    const rect = this.getBoundingClientRect();
    return {
      width: rect.width || FALLBACK_CANVAS_WIDTH,
      height: rect.height || FALLBACK_CANVAS_HEIGHT,
    };
  }

  /** Topmost interactive container at a canvas-space point, or null. */
  private pick(x: number, y: number): Container | null {
    const stage = this.stage;
    if (!stage) {
      return null;
    }
    // Pixi v8 refreshes `worldTransform` only during a render pass, and
    // hit-testing inverse-maps the point through it. With a live
    // renderer the on-demand loop keeps the subtree fresh; renderer-less
    // (headless tests, a pick before the first frame) needs a manual
    // refresh or every container reads as identity.
    if (!this.renderer) {
      refreshWorldTransforms(stage, null);
    }
    return pickAtPoint(stage, x, y);
  }

  clientToDiagram(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const canvas = this.canvasRef.value;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return computeClientToDiagram(
      this.currentView(),
      { width: rect.width, height: rect.height },
      clientX - rect.left,
      clientY - rect.top,
    );
  }

  diagramToClient(
    diagramX: number,
    diagramY: number,
  ): { x: number; y: number } | null {
    const canvas = this.canvasRef.value;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const pt = computeDiagramToClient(
      this.currentView(),
      { width: rect.width, height: rect.height },
      diagramX,
      diagramY,
    );
    return { x: pt.x + rect.left, y: pt.y + rect.top };
  }

  private currentView(): ViewState {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  private onViewChangeFromUser(next: ViewState): void {
    this.updatingFromUser = true;
    this.zoom = next.zoom;
    this.panX = next.panX;
    this.panY = next.panY;
    this.updatingFromUser = false;
    this.applyView();
    this.dispatchEvent(
      new CustomEvent<ViewState>("om-view-change", {
        detail: { ...next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private unmount(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.panZoom?.destroy();
    this.panZoom = null;
    if (this.schedulerRegistered && this.stage) {
      unregisterRenderScheduler(this.stage);
      this.schedulerRegistered = false;
    }
    this.renderer?.destroy();
    this.stage?.destroy({ children: true });
    this.sceneProvider.setValue(null);
    this.parentNodeProvider.setValue(null);
    this.viewStateProvider.setValue(null);
    this.renderer = null;
    this.stage = null;
    this.worldRoot = null;
    this.diagramRoot = null;
  }

  private handleResize(): void {
    const { width, height } = this.cssSize();
    this.renderer?.resize(width, height);
    this.applyView();
  }

  private applyView(): void {
    const worldRoot = this.worldRoot;
    if (!worldRoot) {
      return;
    }
    // The view transform lives on worldRoot — the pan/zoom anchor — so
    // both worldRoot-attached underlay (grid) and diagramRoot entities
    // share it. diagramRoot stays an identity child whose local space is
    // therefore diagram coordinates. The -y scale flips canvas +y-down
    // to Modelica +y-up.
    const { width, height } = this.rendererSize();
    const ppu = height / (2 * this.zoom);
    worldRoot.scale.set(ppu, -ppu);
    worldRoot.position.set(
      width / 2 - this.panX * ppu,
      height / 2 + this.panY * ppu,
    );
    this.viewStateStore.next(this.currentView());
    if (this.stage) {
      requestSceneRender(this.stage);
    }
  }

  /** Diagram units per CSS pixel at the current zoom (`1 / ppu`). */
  private worldPerPixel(): number {
    const { height } = this.rendererSize();
    return (2 * this.zoom) / height;
  }

  /** CSS-pixel render size — the renderer's screen if live, else host. */
  private rendererSize(): { width: number; height: number } {
    const screen = this.renderer?.screen;
    if (screen && screen.width > 0 && screen.height > 0) {
      return { width: screen.width, height: screen.height };
    }
    return this.cssSize();
  }
}

interface HitGeometry {
  hitArea?: { contains(x: number, y: number): boolean } | null;
  containsPoint?: (point: Point) => boolean;
}

const tmpLocal = new Point();

/**
 * Topmost pickable container at a stage-space point, walking children
 * front-to-back by `zIndex` then document order. A container is a hit
 * target when its `eventMode` is `"static"`/`"dynamic"`; `"none"` skips
 * the whole subtree. `hitArea` overrides geometry; otherwise a node's
 * own `containsPoint` (e.g. `Graphics`/`Sprite`) is tested in its local
 * space. Replaces Babylon's `scene.pick` and Pixi's `EventBoundary`
 * (which needs the renderer-installed event mixin to hit-test).
 */
function pickAtPoint(node: Container, x: number, y: number): Container | null {
  if (node.visible === false || node.renderable === false) {
    return null;
  }
  if (node.eventMode === "none") {
    return null;
  }
  if (node.interactiveChildren !== false && node.children.length > 0) {
    const ordered = [...node.children].sort(
      (a, b) => (a.zIndex || 0) - (b.zIndex || 0),
    );
    for (let i = ordered.length - 1; i >= 0; i--) {
      const child = ordered[i];
      if (child) {
        const hit = pickAtPoint(child, x, y);
        if (hit) {
          return hit;
        }
      }
    }
  }
  if (isPickable(node) && containsGlobalPoint(node, x, y)) {
    return node;
  }
  return null;
}

function isPickable(node: Container): boolean {
  return node.eventMode === "static" || node.eventMode === "dynamic";
}

function containsGlobalPoint(node: Container, x: number, y: number): boolean {
  const geom = node as Container & HitGeometry;
  const local = node.worldTransform.applyInverse({ x, y }, tmpLocal);
  if (geom.hitArea) {
    return geom.hitArea.contains(local.x, local.y);
  }
  if (typeof geom.containsPoint === "function") {
    return geom.containsPoint(local);
  }
  return false;
}

/**
 * Recompute `worldTransform` for a container subtree the way the render
 * loop does, so geometric hit-testing works without a live renderer.
 */
function refreshWorldTransforms(
  target: Container,
  parentWorld: Matrix | null,
): void {
  target.updateLocalTransform();
  if (parentWorld) {
    target.worldTransform.appendFrom(target.localTransform, parentWorld);
  } else {
    target.worldTransform.copyFrom(target.localTransform);
  }
  const children = target.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child) {
      refreshWorldTransforms(child, target.worldTransform);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-scene": OmScene;
  }
}
