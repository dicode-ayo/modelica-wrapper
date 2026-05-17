import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { ContextProvider } from "@lit/context";
import {
  ArcRotateCamera,
  Color4,
  Engine,
  Scene,
  TransformNode,
  Vector3,
  type AbstractEngine,
} from "@babylonjs/core";

import { parentNodeContext } from "../base/parent-node-context.js";
import { sceneContext, type SceneContext } from "./scene-context.js";
import { ViewStateStore, viewStateContext } from "./view-state-store.js";
import {
  CAMERA_MODE_ORTHO,
  DEFAULT_CAMERA_RADIUS,
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

/**
 * Factory injected by tests so the scene can mount under Babylon's
 * `NullEngine` (no WebGL needed). In production the default factory
 * creates a real `Engine` against the canvas element.
 */
export type EngineFactory = (canvas: HTMLCanvasElement) => AbstractEngine;

const defaultEngineFactory: EngineFactory = (canvas) =>
  // `stencil: true` is required by Babylon's HighlightLayer (the
  // selection outline). Without it, the layer warns and silently
  // skips its render pass.
  //
  // `alpha: false` makes the WebGL backbuffer opaque. With the
  // default (transparent) backbuffer the browser's GPU compositor
  // can present a half-painted frame during rapid pan/zoom — the
  // big opaque shapes (white extent-rect, axis lines) read as a
  // flicker against the CSS `:host` background. An opaque canvas
  // sidesteps that path entirely.
  //
  // 4th arg `adaptToDeviceRatio: true` sizes the WebGL backbuffer
  // in physical pixels rather than CSS pixels. Without it, HiDPI
  // displays render at 1× and the browser upscales to the device
  // grid — 1-px GL lines (connection strokes) and small meshes
  // (connector dots) look blurry.
  new Engine(
    canvas,
    true,
    {
      preserveDrawingBuffer: false,
      stencil: true,
      disableWebGL2Support: false,
      alpha: false,
    },
    true,
  );

/**
 * `<om-scene>` — root custom element for the graphical layout editor.
 *
 * Creates a Babylon engine + scene on `firstUpdated`, configures an
 * orthographic `ArcRotateCamera` locked to top-down (camera at +Z
 * looking at the XY plane), and exposes two Lit contexts:
 *
 *  - `sceneContext`: full Babylon state for ad-hoc operations (picking,
 *    overlays, fit-to-view math).
 *  - `parentNodeContext`: the `diagramRoot` TransformNode that
 *    entity elements (`<om-component>`, ...) attach to. Children walk
 *    upward via Lit context, not via direct Babylon references.
 *
 * Coordinate convention:
 *   diagram (x, y)  →  world (x, y, 0)
 *   camera = orthographic, positioned on +Z axis, up = (0, 1, 0)
 *   → world +X is screen right, world +Y is screen up.
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
       * which makes the page scrollbars oscillate on/off — and every
       * such toggle triggers engine.resize() (black-framebuffer flash
       * for one frame). Clipping here keeps the canvas size stable.
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
   * Engine factory override. Tests pass a `NullEngine` factory so the
   * scene mounts without a WebGL context. Setting this after mount has
   * no effect. `undefined` falls back to the real-WebGL default.
   */
  @property({ attribute: false })
  engineFactory: EngineFactory | undefined = undefined;

  /**
   * Diagram half-extent currently shown by the orthographic camera (in
   * diagram units). Combined with the canvas aspect ratio to fill in
   * Babylon's `orthoLeft`/`orthoRight`/`orthoTop`/`orthoBottom`.
   */
  @property({ type: Number, reflect: true })
  zoom: number = DEFAULT_EXTENT_HALF;

  /** Camera target X offset (in diagram units). */
  @property({ type: Number, reflect: true, attribute: "pan-x" })
  panX = 0;

  /** Camera target Y offset (in diagram units). */
  @property({ type: Number, reflect: true, attribute: "pan-y" })
  panY = 0;

  /**
   * Camera projection mode:
   *  - `"2d"` (default): orthographic, top-down. Use for the diagram
   *    editor. Pan/zoom is owned by `PanZoom`.
   *  - `"3d"`: perspective, free `ArcRotateCamera` orbit. Used by the
   *    optional MultiBody view. Babylon's built-in camera inputs take
   *    over (mouse drag orbits, wheel zooms in radius).
   */
  @property({ type: String, reflect: true, attribute: "camera-mode" })
  cameraMode: "2d" | "3d" = "2d";

  /**
   * When true, opens Babylon's Inspector (right-side panel showing
   * scene graph, materials, textures, render stats) and enables
   * verbose console logging in the icon-provider rasteriser. Toggle
   * from any story or programmatically via the property.
   *
   * Loaded lazily on first activation — the inspector pulls in
   * ~1 MB of devtools that should never ship to production.
   */
  @property({ type: Boolean, reflect: true })
  debug = false;

  private readonly canvasRef = createRef<HTMLCanvasElement>();
  private readonly resizeObserver = new ResizeObserver(() => this.handleResize());

  private engine: AbstractEngine | null = null;
  private babylonScene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private panZoom: PanZoom | null = null;
  private renderLoopAttached = false;
  /**
   * Set while `PanZoom` is feeding new view state back into the
   * element's properties so `updated()` doesn't re-trigger
   * `applyView()` (it's already applied directly).
   */
  private updatingFromUser = false;

  private readonly sceneProvider = new ContextProvider(this, {
    context: sceneContext,
    initialValue: null,
  });

  private readonly parentNodeProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  /**
   * Behaviour-subject-shaped store of {zoom, panX, panY, version}.
   * `applyView()` is the sole producer; every HTML overlay is a
   * consumer (via `viewStateContext`). Lives for the element's
   * lifetime — the value is replaced on remount, not the store.
   */
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
    // The <slot> sits AFTER the canvas so light-DOM descendants
    // (icon-provider, components, ...) are part of the rendered layout
    // tree. The Babylon mesh path works without the slot — meshes
    // render directly into the canvas — but HTML overlays (e.g. the
    // per-component SVG icon overlay in OmShapeElement) need a real
    // positioning chain. The scene host is `position: relative`, so
    // descendants' `position: absolute` resolves here. Document-order
    // painting puts the slotted overlays above the canvas.
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
    if (!this.camera || this.updatingFromUser) {
      return;
    }
    if (changed.has("zoom") || changed.has("panX") || changed.has("panY")) {
      this.applyView();
    }
    if (changed.has("cameraMode")) {
      this.applyCameraMode();
    }
    if (changed.has("debug")) {
      void this.applyDebugMode();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unmount();
  }

  /**
   * Returns the live Babylon `Scene`, or `null` if the element has not
   * yet finished mounting (or has already been torn down). Exposed for
   * tests and for siblings that need ad-hoc Babylon access.
   */
  get sceneContextValue(): SceneContext | null {
    return this.sceneProvider.value;
  }

  /** Exposes the internal `<canvas>` for siblings that need to attach
   *  pointer listeners (e.g. the interaction manager in stage E1). */
  get canvasElement(): HTMLCanvasElement | null {
    return this.canvasRef.value ?? null;
  }

  private mount(canvas: HTMLCanvasElement): void {
    const factory = this.engineFactory ?? defaultEngineFactory;
    const engine = factory(canvas);
    const scene = new Scene(engine);
    // Match the `:host` CSS background so the opaque backbuffer paints
    // a seamless plate behind the diagram contents. Keeping these in
    // sync avoids a 1-px hairline of either colour at the canvas edge.
    scene.clearColor = new Color4(0.969, 0.969, 0.973, 1);

    const worldRoot = new TransformNode("om-world", scene);
    const diagramRoot = new TransformNode("om-diagram", scene);
    diagramRoot.parent = worldRoot;

    // Camera sits at z = -DEFAULT_CAMERA_RADIUS, looking toward +Z.
    //
    // The (alpha = -π/2, beta = π/2) pairing follows from the
    // ArcRotateCamera positioning formula in Babylon:
    //   position.x = target.x + r * cos(α) * sin(β)   = 0
    //   position.y = target.y + r * cos(β)            = 0
    //   position.z = target.z + r * sin(α) * sin(β)   = -r
    //
    // It matters because Babylon is left-handed and uses
    //   xAxis_camera = cross(up, forward)
    // for the view matrix's right vector. With camera at +Z
    // (α = +π/2), forward = -Z, and `cross((0,1,0), (0,0,-1)) =
    // (-1, 0, 0)` — world +X projects to screen -X, mirroring the
    // icons horizontally AND making mouse-drag direction reversed.
    //
    // With α = -π/2 camera ends up at -Z, forward = +Z, and
    // `cross((0,1,0), (0,0,1)) = (1, 0, 0)`. Now world +X = screen
    // right and world +Y = screen up — Modelica-friendly.
    const camera = new ArcRotateCamera(
      "om-camera",
      -Math.PI / 2,
      Math.PI / 2,
      DEFAULT_CAMERA_RADIUS,
      Vector3.Zero(),
      scene,
    );
    camera.mode = CAMERA_MODE_ORTHO;
    // Disable Babylon's built-in pointer/wheel handling; B2 wires its own.
    camera.inputs.clear();
    // The XY plane is our diagram plane (z = 0) — keep "up" pointing at
    // diagram +y so screen-up matches the Modelica convention.
    camera.upVector = new Vector3(0, 1, 0);

    this.engine = engine;
    this.babylonScene = scene;
    this.camera = camera;

    const ctx: SceneContext = {
      engine,
      scene,
      camera,
      worldRoot,
      diagramRoot,
    };
    this.sceneProvider.setValue(ctx);
    this.parentNodeProvider.setValue(diagramRoot);

    this.handleResize();
    this.applyView();

    this.panZoom = new PanZoom(
      canvas,
      () => ({ zoom: this.zoom, panX: this.panX, panY: this.panY }),
      (next) => this.onViewChangeFromUser(next),
    );

    this.resizeObserver.observe(this);

    engine.runRenderLoop(() => {
      if (this.babylonScene) {
        this.babylonScene.render();
      }
    });
    this.renderLoopAttached = true;
  }

  /**
   * Converts a viewport pixel coordinate (e.g. `event.clientX/Y`) to
   * diagram coordinates. Returns `null` until the canvas has a non-zero
   * bounding rect.
   */
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

  /**
   * Converts diagram coordinates to a viewport pixel position. Useful
   * for placing HTML overlays above scene entities. Returns `null`
   * until the canvas has a non-zero bounding rect.
   */
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
    // `applyView()` pushes to the internal viewStateStore (consumed by
    // shape overlays). The DOM event below is the public-facing
    // notification for external listeners (e.g. host webview).
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
    this.resizeObserver.disconnect();
    this.panZoom?.destroy();
    this.panZoom = null;
    if (this.renderLoopAttached && this.engine) {
      this.engine.stopRenderLoop();
      this.renderLoopAttached = false;
    }
    this.babylonScene?.dispose();
    this.engine?.dispose();
    this.sceneProvider.setValue(null);
    this.parentNodeProvider.setValue(null);
    this.viewStateProvider.setValue(null);
    this.babylonScene = null;
    this.engine = null;
    this.camera = null;
  }

  private async applyDebugMode(): Promise<void> {
    const scene = this.babylonScene;
    if (!scene) {
      return;
    }
    setRasterizerDebug(this.debug);
    if (this.debug) {
      // Lazy-load the inspector so it never ships in production
      // bundles. Side-effect import — attaches `scene.debugLayer.show()`.
      try {
        await import("@babylonjs/inspector");
        await scene.debugLayer.show({
          embedMode: false,
          overlay: true,
          handleResize: true,
        });
        // eslint-disable-next-line no-console
        console.info(
          "[diagram-ui] Babylon Inspector loaded. Open the right-side panel " +
            "to inspect meshes, materials, and textures.",
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[diagram-ui] Failed to load Babylon Inspector:", err);
      }
    } else if (scene.debugLayer.isVisible()) {
      scene.debugLayer.hide();
    }
  }

  private handleResize(): void {
    const engine = this.engine;
    if (!engine) {
      return;
    }
    engine.resize();
    this.applyView();
  }

  private applyView(): void {
    const camera = this.camera;
    const engine = this.engine;
    if (!camera || !engine) {
      return;
    }
    const width = engine.getRenderWidth() || FALLBACK_CANVAS_WIDTH;
    const height = engine.getRenderHeight() || FALLBACK_CANVAS_HEIGHT;
    const aspect = width / height;
    const halfH = this.zoom;
    const halfW = halfH * aspect;
    camera.orthoLeft = -halfW;
    camera.orthoRight = halfW;
    camera.orthoTop = halfH;
    camera.orthoBottom = -halfH;
    // Camera target shifts so diagram (panX, panY) appears at screen centre.
    camera.target.set(this.panX, this.panY, 0);
    // Keep the camera on -Z axis at the target — radius is informational
    // in ortho mode but the camera still needs a position to derive the
    // view matrix. See the mount() comment for the α/β derivation.
    camera.alpha = -Math.PI / 2;
    camera.beta = Math.PI / 2;
    // Push to the reactive store — every HTML overlay is subscribed
    // and re-projects on emit. `version` is always bumped so a resize
    // (zoom/pan unchanged, aspect different) still notifies. The
    // `om-view-change` DOM event is preserved separately in
    // onViewChangeFromUser for the public API.
    this.viewStateStore.next(this.currentView());
  }

  private applyCameraMode(): void {
    const camera = this.camera;
    const canvas = this.canvasRef.value;
    if (!camera || !canvas) {
      return;
    }
    if (this.cameraMode === "2d") {
      camera.mode = CAMERA_MODE_ORTHO;
      camera.detachControl();
      camera.inputs.clear();
      this.applyView();
      if (!this.panZoom) {
        this.panZoom = new PanZoom(
          canvas,
          () => ({ zoom: this.zoom, panX: this.panX, panY: this.panY }),
          (next) => this.onViewChangeFromUser(next),
        );
      }
    } else {
      camera.mode = 0; // Babylon.Camera.PERSPECTIVE_CAMERA
      this.panZoom?.destroy();
      this.panZoom = null;
      camera.inputs.addMouseWheel();
      camera.inputs.addPointers();
      camera.attachControl(canvas, true);
      camera.lowerRadiusLimit = 10;
      camera.upperRadiusLimit = 5000;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-scene": OmScene;
  }
}
