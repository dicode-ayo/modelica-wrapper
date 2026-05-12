import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { ContextProvider, consume } from "@lit/context";
import {
  Quaternion,
  Vector3,
  type Camera,
  type Observer,
  type Scene,
} from "@babylonjs/core";
import { renderIconLayersToSvg } from "@modelica-wrapper/diagram-svg";
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

  protected readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  protected shapeNode: OmShapeNode | null = null;
  private currentTextureToken: symbol | null = null;

  private readonly overlayRef = createRef<OmIconOverlay>();
  private overlayObserver: Observer<Scene> | null = null;
  private overlayScene: Scene | null = null;
  private overlaySrcKey: {
    layers: IconLayer[];
    cs: CoordinateSystem | undefined;
  } | null = null;
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
      this.ensureOverlayObserver();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.currentTextureToken = null;
    this.detachOverlayObserver();
    this.shapeNode?.dispose();
    this.shapeNode = null;
    this.childContextProvider.setValue(null);
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
    this.childContextProvider.setValue(this.shapeNode.transform);
    this.onShapeNodeReady(this.shapeNode);
  }

  private refreshTexture(): void {
    const node = this.shapeNode;
    const provider = this.iconProvider;
    if (!node) {
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
      return;
    }
    if (
      this.overlaySrcKey &&
      this.overlaySrcKey.layers === this.layers &&
      this.overlaySrcKey.cs === this.coordinateSystem
    ) {
      return;
    }
    const svg = renderIconLayersToSvg(this.layers, {
      coordinateSystem: this.coordinateSystem,
    });
    overlay.src = svgToDataUrl(svg);
    this.overlaySrcKey = {
      layers: this.layers,
      cs: this.coordinateSystem,
    };
  }

  private ensureOverlayObserver(): void {
    if (this.overlayObserver) {
      return;
    }
    const node = this.shapeNode;
    if (!node) {
      return;
    }
    const scene = node.transform.getScene();
    this.overlayScene = scene;
    this.overlayObserver = scene.onBeforeRenderObservable.add(() =>
      this.updateOverlayLayout(),
    );
    // Position immediately so the first paint doesn't show the overlay
    // at (0, 0) before the first render-loop tick.
    this.updateOverlayLayout();
  }

  private detachOverlayObserver(): void {
    if (this.overlayObserver && this.overlayScene) {
      this.overlayScene.onBeforeRenderObservable.remove(this.overlayObserver);
    }
    this.overlayObserver = null;
    this.overlayScene = null;
  }

  /**
   * Per-frame: derive the icon's screen-space rect from the mesh's
   * world matrix (so nested entities — e.g. `<om-connector>` inside a
   * scaled `<om-component>` — pick up accumulated parent scaling).
   * Hide entirely if the camera isn't orthographic; the in-canvas
   * texture takes over in that case.
   */
  private updateOverlayLayout(): void {
    const overlay = this.overlayRef.value;
    const node = this.shapeNode;
    const scene = this.overlayScene;
    if (!overlay || !node || !scene) {
      return;
    }
    const camera = scene.activeCamera as Camera | null;
    const engine = scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!camera || !canvas || !isOrthographic(camera) || !overlay.src) {
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

    // Decompose the MESH's world matrix — combines every ancestor's
    // scaling/rotation/translation. `mesh.scaling` is `iconSize` and
    // `mesh.position` is the icon-coord centre, so the decomposed
    // world translation is the icon centre in world space and the
    // world scale is the icon's true world width/height (whether or
    // not the entity is nested inside another scaled entity).
    node.mesh.computeWorldMatrix(true);
    const ok = node.mesh
      .getWorldMatrix()
      .decompose(this.tmpScale, this.tmpRot, this.tmpTrans);
    if (!ok) {
      overlay.hide();
      return;
    }

    const pxPerUnitX = canvasW / (ortho.right - ortho.left);
    const pxPerUnitY = canvasH / (ortho.top - ortho.bottom);

    // Screen pixel position of icon centre. Canvas Y is down; world Y
    // is up — hence the sign flip on Y.
    const sx = (this.tmpTrans.x - camera.position.x) * pxPerUnitX + canvasW / 2;
    const sy = -(this.tmpTrans.y - camera.position.y) * pxPerUnitY + canvasH / 2;

    const widthPx = Math.abs(this.tmpScale.x) * pxPerUnitX;
    const heightPx = Math.abs(this.tmpScale.y) * pxPerUnitY;

    // Modelica rotation: CCW positive (math Y-up). CSS rotate: CW
    // positive (screen Y-down). Negate when converting world → CSS.
    const rotationRad = quaternionToZ(this.tmpRot);
    const rotationDeg = -rotationRad * (180 / Math.PI);

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
