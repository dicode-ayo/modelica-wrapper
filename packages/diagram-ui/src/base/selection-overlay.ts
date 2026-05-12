import {
  Color3,
  HighlightLayer,
  Mesh,
  MeshBuilder,
  Observer,
  StandardMaterial,
  type ArcRotateCamera,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";

/**
 * Per-scene HighlightLayer that wraps selection outlines for every
 * `OmShapeNode`. Lazily instantiated; one Babylon HighlightLayer
 * covers the whole scene.
 *
 * NullEngine doesn't support HighlightLayer (it relies on stencil
 * buffer), so the lookup is guarded — headless tests skip the
 * outline but still drive the `selected` state flag.
 */
const META_KEY = "omHighlightLayer";

interface HighlightMeta {
  [META_KEY]?: HighlightLayer | undefined;
}

export function ensureHighlightLayer(scene: Scene): HighlightLayer | null {
  if (scene.getEngine().constructor.name === "NullEngine") {
    return null;
  }
  const md = (scene.metadata as HighlightMeta | null | undefined) ?? {};
  if (md[META_KEY]) {
    return md[META_KEY] ?? null;
  }
  const layer = new HighlightLayer("om-highlight", scene);
  layer.innerGlow = false;
  layer.outerGlow = true;
  layer.blurHorizontalSize = 0.6;
  layer.blurVerticalSize = 0.6;
  md[META_KEY] = layer;
  scene.metadata = md;
  scene.onDisposeObservable.add(() => {
    layer.dispose();
    md[META_KEY] = undefined;
  });
  return layer;
}

/**
 * Four corner resize handles for a single shape node. Sized in screen
 * pixels (kept constant via an onBeforeRender observer that rescales
 * each handle against the camera's ortho extents).
 */
export class ResizeHandles {
  private readonly handles: Mesh[] = [];
  private readonly material: StandardMaterial;
  private readonly observer: Observer<Scene> | null = null;
  private currentVisible = false;

  constructor(
    private readonly scene: Scene,
    parent: TransformNode,
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
    private readonly handlePixelSize: number = 8,
    private readonly camera: ArcRotateCamera | null = null,
  ) {
    this.material = new StandardMaterial("om-handle-mat", scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = new Color3(0.96, 0.98, 1);

    const corners: Array<["tl" | "tr" | "br" | "bl", number, number]> = [
      ["tl", iconCx - iconWidth / 2, iconCy + iconHeight / 2],
      ["tr", iconCx + iconWidth / 2, iconCy + iconHeight / 2],
      ["br", iconCx + iconWidth / 2, iconCy - iconHeight / 2],
      ["bl", iconCx - iconWidth / 2, iconCy - iconHeight / 2],
    ];
    for (const [corner, lx, ly] of corners) {
      const handle = MeshBuilder.CreatePlane(
        `om-handle:${corner}`,
        { width: 1, height: 1 },
        scene,
      );
      handle.material = this.material;
      handle.parent = parent;
      // Negative z = closer to camera (sits at -Z) so resize handles
      // paint on top of every other entity.
      handle.position.set(lx, ly, -0.02);
      handle.isVisible = false;
      handle.isPickable = true;
      handle.metadata = { kind: "handle", nodeId: corner };
      this.handles.push(handle);
    }

    this.observer = scene.onBeforeRenderObservable.add(() => this.rescale());
  }

  setVisible(visible: boolean): void {
    this.currentVisible = visible;
    for (const h of this.handles) {
      h.isVisible = visible;
    }
    if (visible) {
      this.rescale();
    }
  }

  isVisible(): boolean {
    return this.currentVisible;
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
    }
    for (const h of this.handles) {
      h.dispose();
    }
    this.handles.length = 0;
    this.material.dispose();
  }

  private rescale(): void {
    if (!this.currentVisible) {
      return;
    }
    // Screen-pixel size derived from the camera's current orthographic
    // extent + canvas dimensions. Falls back to a small constant when
    // either is unavailable (e.g. before first resize).
    const camera = this.camera ?? findOrthoCamera(this.scene);
    if (!camera) {
      return;
    }
    const engine = this.scene.getEngine();
    const canvasW = engine.getRenderWidth() || 1;
    const orthoRight = camera.orthoRight ?? 1;
    const orthoLeft = camera.orthoLeft ?? -1;
    const worldPerPixel = (orthoRight - orthoLeft) / canvasW;
    const size = this.handlePixelSize * worldPerPixel;
    for (const h of this.handles) {
      h.scaling.set(size, size, 1);
    }
  }
}

function findOrthoCamera(scene: Scene): ArcRotateCamera | null {
  const cam = scene.activeCamera;
  if (cam && (cam as ArcRotateCamera).orthoLeft !== undefined) {
    return cam as ArcRotateCamera;
  }
  return null;
}
