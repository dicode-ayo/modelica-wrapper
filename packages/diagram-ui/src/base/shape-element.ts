import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { ContextConsumer, ContextProvider, consume } from "@lit/context";
import {
  Quaternion,
  Vector3,
  type Camera,
} from "@babylonjs/core";
import {
  computeIconBounds,
  renderIconLayersToSvg,
  type IconBounds,
} from "@modelica-wrapper/diagram-svg";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "./parent-node-context.js";
import {
  iconProviderContext,
  type IconProviderContext,
} from "../icon-provider/icon-provider-context.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";
import { OmShapeNode } from "./shape-node.js";
import { CAMERA_MODE_ORTHO } from "../constants.js";
import "./icon-overlay.component.js";
import type { OmIconOverlay } from "./icon-overlay.component.js";

/**
 * Base class for `<om-component>`, `<om-connector>`, and other shape-
 * carrying entities. Bridges the Lit lifecycle to:
 *
 *   1. A Babylon `OmShapeNode` (textured plane in the canvas — used in
 *      3D / perspective mode where the HTML overlay can't track).
 *   2. A single `<om-icon-overlay>` HTML element parked in the entity's
 *      shadow DOM (the visible icon in 2D / orthographic mode). The
 *      overlay tracks the Babylon TransformNode each frame.
 *
 * Subclasses only need to:
 *   - Pick a `nodeName` for debugging
 *   - Optionally override `onShapeNodeReady(node)` to add extra meshes
 *     (e.g. the port-indicator dot on `<om-connector>`)
 *
 * Why use both renderers:
 *   - The HTML overlay is crisper, lets the browser handle SVG, and
 *     plays nicely with DOM debugging.
 *   - The in-canvas plane is the fallback when the camera can't
 *     map world → screen with a uniform 2D mapping (i.e. perspective
 *     / 3D MultiBody view).
 */
export abstract class OmShapeElement extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  /** Modelica placement of this entity in its parent's coord system. */
  @property({ attribute: false })
  placement: Placement = { extent: [[-10, -10], [10, 10]] };

  /** Icon shape layers (ancestor-first / host-last). */
  @property({ attribute: false })
  layers: IconLayer[] = [];

  /** Coordinate system declared by the icon's host class. */
  @property({ attribute: false })
  coordinateSystem: CoordinateSystem | undefined = undefined;

  /**
   * Stroke-width multiplier forwarded to `renderIconLayersToSvg`. See
   * the renderer doc for full semantics — short version: spec-default
   * `0.25` icon-unit strokes are too thin on high-density displays,
   * and a value of `2` keeps them visible without re-authoring icon
   * annotations. `undefined` keeps the renderer's own default.
   */
  @property({ type: Number, attribute: "line-thickness-scale" })
  lineThicknessScale: number | undefined = undefined;

  /** Selection state — purely a flag for now (E2 wires visuals). */
  @property({ type: Boolean, reflect: true })
  selected = false;

  /** Read-only flag forwarded to the interaction manager in stage E. */
  @property({ type: Boolean, reflect: true })
  readonly = false;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: import("@babylonjs/core").TransformNode | null = null;

  @consume({ context: iconProviderContext, subscribe: true })
  protected iconProvider: IconProviderContext | null = null;

  /**
   * Wire the per-instance ContextConsumer in the constructor (not as
   * a field initialiser) so we don't have to hold a dangling
   * reference just to keep tsc happy under `noUnusedLocals`. The
   * consumer registers itself as a reactive controller on `this`, so
   * the host element keeps it alive; we only care about the callback,
   * which re-wires the store's `subscribe()` each time Lit hands us a
   * new store reference (mount, scene teardown, hot reload).
   */
  constructor() {
    super();
    new ContextConsumer(this, {
      context: viewStateContext,
      subscribe: true,
      callback: (store) => this.resubscribeViewState(store),
    });
  }

  protected readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  protected shapeNode: OmShapeNode | null = null;
  private currentTextureToken: symbol | null = null;

  private readonly overlayRef = createRef<OmIconOverlay>();
  /** Unsubscribe from the scene's view-state store; set on connect. */
  private viewStateUnsubscribe: (() => void) | null = null;
  private overlaySrcKey: {
    layers: IconLayer[];
    cs: CoordinateSystem | undefined;
    scale: number | undefined;
  } | null = null;
  /**
   * Cached union of `coord-system extent ∪ every shape extent`. Used
   * to size the overlay so labels placed outside the canonical icon
   * box (Modelica `%name`, parameter readouts, dimension callouts —
   * extremely common) stop being clipped at the SVG viewBox boundary.
   * Recomputed alongside the SVG src whenever the layers identity
   * changes.
   */
  private iconBounds: IconBounds | null = null;
  /**
   * Last camera-mode classification applied to the in-canvas plane.
   *   `null`        — observer hasn't run yet, no decision made.
   *   `"ortho"`     — overlay is the visible icon, in-canvas plane
   *                   alpha=0, icon-provider fetch deferred.
   *   `"perspective"` — in-canvas textured plane is the visible icon,
   *                   icon-provider has been asked for the texture.
   */
  private inCanvasMode: "ortho" | "perspective" | null = null;
  /** Scratch buffers reused by the per-frame projection math. */
  private readonly tmpScale = new Vector3();
  private readonly tmpRot = new Quaternion();
  private readonly tmpTrans = new Vector3();

  protected abstract babylonNodeName(): string;

  /** Hook for subclasses to add extra Babylon geometry to the shape. */
  protected onShapeNodeReady(_node: OmShapeNode): void {
    /* default: no-op */
  }

  /**
   * Z-axis offset (in parent local units) used to layer entities. The
   * default `0` puts components on the diagram plane; subclasses
   * override to lift themselves slightly toward the camera (which sits
   * on +Z), e.g. connectors render on top of components.
   */
  protected zOffset(): number {
    return 0;
  }

  override render() {
    return html`<om-icon-overlay ${ref(this.overlayRef)}></om-icon-overlay
      ><slot></slot>`;
  }

  override updated(_changed: Map<string, unknown>): void {
    this.ensureShapeNode();
    if (this.shapeNode) {
      this.shapeNode.setPlacement(
        this.placement,
        this.coordinateSystem,
        this.zOffset(),
      );
      this.shapeNode.setSelected(this.selected);
      this.refreshTexture();
      this.refreshOverlaySrc();
      // Project this element's overlay now that geometry has been
      // applied. Then walk descendants: when a parent moves (placement
      // prop changed → Lit fires updated() on the parent only), child
      // shape-elements' Lit props haven't changed, so their own
      // updated() doesn't fire — but their world matrices sit at a
      // new position because their TransformNodes are parented here.
      // The walk re-projects them in sync.
      this.updateOverlayLayout();
      this.updateDescendantOverlays();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewStateUnsubscribe?.();
    this.viewStateUnsubscribe = null;
    this.currentTextureToken = null;
    this.shapeNode?.dispose();
    this.shapeNode = null;
    this.childContextProvider.setValue(null);
  }

  /**
   * Attach the store subscription. The store's `subscribe()` fires
   * once immediately with the current snapshot (behaviour-subject
   * semantics) which positions the overlay correctly on first paint
   * without waiting for a pan. Camera/canvas changes after that are
   * delivered as additional emissions.
   */
  private resubscribeViewState(store: ViewStateStore | null): void {
    this.viewStateUnsubscribe?.();
    this.viewStateUnsubscribe = null;
    if (!store) return;
    this.viewStateUnsubscribe = store.subscribe(() => {
      this.updateOverlayLayout();
      // Resize handles are sized in screen pixels — they must rescale
      // when the camera's worldPerPixel changes (zoom or canvas
      // resize). The view-state store emits on every such change, so
      // this replaces what used to be a per-frame onBeforeRender
      // observer in `ResizeHandles`.
      this.shapeNode?.rescaleResizeHandles();
    });
  }

  private updateDescendantOverlays(): void {
    // Light-DOM walk: `<om-component>` slots its `<om-connector>` children,
    // and `<om-connector>` could host its own sub-shapes. `children` is
    // recursive via the closure; `instanceof OmShapeElement` is O(1).
    const walk = (root: Element): void => {
      for (const child of Array.from(root.children)) {
        if (child instanceof OmShapeElement) {
          child.updateOverlayLayout();
        }
        walk(child);
      }
    };
    walk(this);
  }

  private ensureShapeNode(): void {
    if (this.shapeNode) {
      return;
    }
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const scene = parent.getScene();
    this.shapeNode = new OmShapeNode(scene, parent, this.babylonNodeName());
    // Start with the in-canvas plane invisible. The first frame of
    // the overlay observer will flip it back on if the camera turns
    // out to be perspective. This avoids a one-frame magenta flash
    // while the texture hasn't loaded yet.
    this.shapeNode.setInCanvasVisible(false);
    this.childContextProvider.setValue(this.shapeNode.transform);
    this.onShapeNodeReady(this.shapeNode);
  }

  /**
   * Apply the camera-mode classification: toggle the in-canvas
   * plane's material alpha (so the textured plane stops painting in
   * 2D mode) and trigger or skip the icon-provider fetch
   * accordingly. Idempotent — caller can invoke every frame.
   */
  private applyInCanvasMode(mode: "ortho" | "perspective"): void {
    if (this.inCanvasMode === mode) {
      return;
    }
    this.inCanvasMode = mode;
    if (this.shapeNode) {
      this.shapeNode.setInCanvasVisible(mode === "perspective");
    }
    // Mode just flipped — re-evaluate texture binding (fetch on enter
    // perspective, unbind on enter ortho).
    this.refreshTexture();
  }

  /**
   * Fetch + bind the in-canvas texture, but ONLY when the in-canvas
   * plane is currently the visible icon (`inCanvasMode === "perspective"`).
   * Under orthographic projection the HTML overlay covers the canvas
   * plane entirely, so any SVG rasterisation + GPU sample would be
   * wasted work — we keep the texture unbound and lean on
   * `OmShapeNode.setInCanvasVisible(false)` to skip rendering of the
   * plane while preserving the HighlightLayer selection outline.
   */
  private refreshTexture(): void {
    const node = this.shapeNode;
    const provider = this.iconProvider;
    if (!node) {
      return;
    }
    // Defer texture fetch until we know the camera is in a mode where
    // the in-canvas plane will actually be visible.
    if (this.inCanvasMode !== "perspective") {
      this.currentTextureToken = null;
      node.setTexture(null);
      return;
    }
    if (!provider || this.layers.length === 0) {
      node.setTexture(null);
      this.currentTextureToken = null;
      return;
    }
    const token = Symbol();
    this.currentTextureToken = token;
    provider
      .textureForLayers(this.layers, this.coordinateSystem)
      .then((tex) => {
        if (this.currentTextureToken === token && this.shapeNode) {
          this.shapeNode.setTexture(tex);
        }
      })
      .catch(() => {
        if (this.currentTextureToken === token && this.shapeNode) {
          this.shapeNode.setTexture(null);
        }
      });
  }

  /**
   * Regenerate the SVG data URL only when `layers` or `coordinateSystem`
   * change identity. The producer emits stable references for
   * unchanged classes, so the common case (placement-only edits) skips
   * the SVG rebuild entirely.
   */
  private refreshOverlaySrc(): void {
    const overlay = this.overlayRef.value;
    if (!overlay) {
      return;
    }
    if (this.layers.length === 0) {
      overlay.src = "";
      this.overlaySrcKey = null;
      this.iconBounds = null;
      return;
    }
    if (
      this.overlaySrcKey &&
      this.overlaySrcKey.layers === this.layers &&
      this.overlaySrcKey.cs === this.coordinateSystem &&
      this.overlaySrcKey.scale === this.lineThicknessScale
    ) {
      return;
    }
    const renderOpts: import("@modelica-wrapper/diagram-svg").RenderOptions = {
      coordinateSystem: this.coordinateSystem,
      expandViewBoxToShapes: true,
    };
    if (this.lineThicknessScale !== undefined) {
      renderOpts.lineThicknessScale = this.lineThicknessScale;
    }
    const svg = renderIconLayersToSvg(this.layers, renderOpts);
    overlay.src = svgToDataUrl(svg);
    this.iconBounds = computeIconBounds(this.layers, this.coordinateSystem);
    this.overlaySrcKey = {
      layers: this.layers,
      cs: this.coordinateSystem,
      scale: this.lineThicknessScale,
    };
  }

  /**
   * Derive the icon's screen-space rect from the mesh's world matrix
   * (so nested entities — e.g. `<om-connector>` inside a scaled
   * `<om-component>` — pick up accumulated parent scaling). Hide
   * entirely if the camera isn't orthographic; the in-canvas texture
   * takes over in that case.
   *
   * Public so a parent shape-element can re-project its descendants
   * after its own Lit `updated()` runs, and so the scene's
   * `om-view-change` listener can call it directly without going
   * through the Lit lifecycle.
   */
  updateOverlayLayout(): void {
    const overlay = this.overlayRef.value;
    const node = this.shapeNode;
    if (!overlay || !node) {
      return;
    }
    const scene = node.transform.getScene();
    const camera = scene.activeCamera as Camera | null;
    const engine = scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    // Classify camera mode FIRST — even when we end up hiding the
    // overlay (no canvas, no extents, etc.) we still want to apply
    // the in-canvas plane visibility so it stays in sync with the
    // user's actual view.
    const cameraIsOrtho = !!camera && isOrthographic(camera);
    this.applyInCanvasMode(cameraIsOrtho ? "ortho" : "perspective");

    if (!camera || !canvas || !cameraIsOrtho || !overlay.src) {
      overlay.hide();
      return;
    }
    const ortho = readOrthoExtents(camera);
    if (!ortho) {
      overlay.hide();
      return;
    }
    const canvasW = canvas.clientWidth || engine.getRenderWidth();
    const canvasH = canvas.clientHeight || engine.getRenderHeight();
    if (canvasW <= 0 || canvasH <= 0) {
      overlay.hide();
      return;
    }

    // Decompose the TRANSFORM's world matrix (NOT the mesh's). The
    // mesh has `iconSize` baked into its local scaling so its
    // decomposed scale equals placement-in-world; we'd lose the
    // information needed to apply a different (union) size. Decomposing
    // the transform gives the icon-coord → world scale and the
    // entity's accumulated rotation/translation directly.
    node.transform.computeWorldMatrix(true);
    const ok = node.transform
      .getWorldMatrix()
      .decompose(this.tmpScale, this.tmpRot, this.tmpTrans);
    if (!ok) {
      overlay.hide();
      return;
    }

    const pxPerUnitX = canvasW / (ortho.right - ortho.left);
    const pxPerUnitY = canvasH / (ortho.top - ortho.bottom);

    // Bounds default to the icon's own size when we haven't computed
    // a union yet (e.g. while layers are still empty). Fall back to
    // `mesh.scaling` (= iconSize) so the overlay still tracks the
    // entity.
    const bounds = this.iconBounds;
    const meshScaling = node.mesh.scaling;
    const unionWidth = bounds
      ? bounds.maxX - bounds.minX
      : Math.abs(meshScaling.x);
    const unionHeight = bounds
      ? bounds.maxY - bounds.minY
      : Math.abs(meshScaling.y);
    const unionCenterX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
    const unionCenterY = bounds ? (bounds.minY + bounds.maxY) / 2 : 0;

    // Convert the (icon-coord) union centre into world coords by
    // applying the entity's accumulated rotation+scale.
    const rotZ = quaternionToZ(this.tmpRot);
    const cos = Math.cos(rotZ);
    const sin = Math.sin(rotZ);
    const localX = unionCenterX * this.tmpScale.x;
    const localY = unionCenterY * this.tmpScale.y;
    const worldX = this.tmpTrans.x + (localX * cos - localY * sin);
    const worldY = this.tmpTrans.y + (localX * sin + localY * cos);

    // Project to canvas pixels. Canvas Y is down; world Y is up.
    //
    // We read `camera.target`, not `camera.position`. ArcRotateCamera
    // derives `position` from `(alpha, beta, radius, target)` and only
    // recomputes it inside `_getViewMatrix()` at render time. The
    // view-state store fires synchronously inside `<om-scene>.applyView()`
    // — right after we write `camera.target` but BEFORE Babylon's next
    // render — so `camera.position` still holds the previous frame's
    // value. Reading `target` (the field we just set) keeps the overlay
    // in lock-step with the canvas; otherwise icons "dance" one frame
    // behind during pan/zoom.
    //
    // In this scene's ortho config (alpha = -π/2, beta = π/2),
    // position.x == target.x and position.y == target.y by construction,
    // so this is a strictly equivalent read. `target` lives on
    // TargetCamera (and ArcRotateCamera), not on the abstract Camera —
    // narrow via a structural cast since `<om-scene>` always installs
    // an ArcRotateCamera here.
    const target = (camera as Camera & { target: { x: number; y: number } })
      .target;
    const sx = (worldX - target.x) * pxPerUnitX + canvasW / 2;
    const sy = -(worldY - target.y) * pxPerUnitY + canvasH / 2;

    const widthPx = unionWidth * Math.abs(this.tmpScale.x) * pxPerUnitX;
    const heightPx = unionHeight * Math.abs(this.tmpScale.y) * pxPerUnitY;

    // Modelica rotation: CCW positive (math Y-up). CSS rotate: CW
    // positive (screen Y-down). Negate when converting world → CSS.
    const rotationDeg = -rotZ * (180 / Math.PI);

    overlay.setLayout(sx, sy, widthPx, heightPx, rotationDeg);
  }
}

interface OrthoExtents {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function readOrthoExtents(camera: Camera): OrthoExtents | null {
  const c = camera as Camera & {
    orthoLeft?: number | null;
    orthoRight?: number | null;
    orthoTop?: number | null;
    orthoBottom?: number | null;
  };
  if (
    c.orthoLeft == null ||
    c.orthoRight == null ||
    c.orthoTop == null ||
    c.orthoBottom == null
  ) {
    return null;
  }
  return {
    left: c.orthoLeft,
    right: c.orthoRight,
    top: c.orthoTop,
    bottom: c.orthoBottom,
  };
}

function isOrthographic(camera: Camera | null): boolean {
  if (!camera) {
    return false;
  }
  return camera.mode === CAMERA_MODE_ORTHO;
}

/**
 * Extract the Z-axis rotation (radians) from a quaternion. Babylon
 * stores rotation as a unit quaternion; the icon's only rotation is
 * around Z (it lives in the XY plane), so we recover the angle from
 * the conventional `atan2(2(wz + xy), 1 - 2(y² + z²))` Euler formula.
 */
function quaternionToZ(q: Quaternion): number {
  const sinyCosp = 2 * (q.w * q.z + q.x * q.y);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  return Math.atan2(sinyCosp, cosyCosp);
}

/**
 * URL-encode an SVG string into a data URI. We use percent-encoding
 * rather than base64 so the URL stays human-readable in devtools and
 * the encoding cost is negligible compared to the SVG render itself.
 */
function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
