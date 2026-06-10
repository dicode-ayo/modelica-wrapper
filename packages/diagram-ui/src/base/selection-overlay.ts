import {
  Color3,
  CreateGreasedLine,
  HighlightLayer,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
  type ArcRotateCamera,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";

import { requestSceneRender } from "../scene/render-scheduler.js";
import { normaliseRect, type DiagramRect } from "../interaction/layout-ops.js";

/**
 * Per-scene HighlightLayer with refcounted lifecycle.
 *
 * Babylon's `HighlightLayer` runs render-to-texture + gaussian blur
 * passes every frame whenever the layer exists, even when no mesh is
 * currently highlighted. In software-rendered WebGL (Linux/VSCode with
 * hardware acceleration off) those passes dominate the frame budget.
 * The fix: create the layer only when the first mesh is added, dispose
 * it again when the last mesh leaves. With nothing selected, there is
 * no layer and no per-frame work.
 *
 * `NullEngine` doesn't support HighlightLayer (no stencil buffer), so
 * the helpers are no-ops there — headless tests still drive the
 * `selected` state flag on entities but skip the visual outline.
 */
const STATE_KEY = "omHighlightState";

interface HighlightState {
  layer: HighlightLayer | null;
  members: Set<Mesh>;
}

interface SceneMeta {
  [STATE_KEY]?: HighlightState | undefined;
}

function getOrCreateState(scene: Scene): HighlightState | null {
  if (scene.getEngine().constructor.name === "NullEngine") {
    return null;
  }
  const md = (scene.metadata as SceneMeta | null | undefined) ?? {};
  let state = md[STATE_KEY];
  if (state) {
    return state;
  }
  state = { layer: null, members: new Set() };
  md[STATE_KEY] = state;
  scene.metadata = md;
  scene.onDisposeObservable.add(() => {
    state!.layer?.dispose();
    state!.layer = null;
    state!.members.clear();
    md[STATE_KEY] = undefined;
  });
  return state;
}

function createHighlightLayer(scene: Scene): HighlightLayer {
  const layer = new HighlightLayer("om-highlight", scene);
  layer.innerGlow = false;
  layer.outerGlow = true;
  layer.blurHorizontalSize = 0.6;
  layer.blurVerticalSize = 0.6;
  return layer;
}

/**
 * Toggle a mesh's highlight outline. Passing `color` adds (or recolours)
 * the mesh; passing `null` removes it. The HighlightLayer itself is
 * lazily created on the first add and disposed when the last mesh is
 * removed — so a scene with no current selection pays zero per-frame
 * cost for the layer's post-processing passes.
 */
export function setMeshHighlight(
  scene: Scene,
  mesh: Mesh,
  color: Color3 | null,
): void {
  const state = getOrCreateState(scene);
  if (!state) {
    return;
  }
  if (color === null) {
    if (!state.members.has(mesh)) {
      return;
    }
    state.layer?.removeMesh(mesh);
    state.members.delete(mesh);
    if (state.members.size === 0 && state.layer) {
      state.layer.dispose();
      state.layer = null;
    }
    requestSceneRender(scene);
    return;
  }
  if (!state.layer) {
    state.layer = createHighlightLayer(scene);
  }
  // HighlightLayer keys by mesh, so a colour change is remove-then-add.
  if (state.members.has(mesh)) {
    state.layer.removeMesh(mesh);
  }
  state.layer.addMesh(mesh, color);
  state.members.add(mesh);
  requestSceneRender(scene);
}

/**
 * Crisp rectangular outline around a shape's icon extent. Built from
 * a single closed `GreasedLine`, so we get a multi-pixel-wide stroke
 * without the gaussian-blur shimmer the old `HighlightLayer` produced
 * over a field of opaque primitive meshes. Cheap to create and dispose;
 * rebuilt on size change the same way `ResizeHandles` is.
 */
export class SelectionOutline {
  private line: AbstractMesh;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
    private color: Color3 = new Color3(0.38, 0.6, 0.98),
    private widthPx: number = 4,
  ) {
    this.line = this.build(iconWidth, iconHeight, iconCx, iconCy);
  }

  private build(
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
  ): AbstractMesh {
    const x0 = iconCx - iconWidth / 2;
    const x1 = iconCx + iconWidth / 2;
    const y0 = iconCy - iconHeight / 2;
    const y1 = iconCy + iconHeight / 2;
    // Slight -Z bias keeps the outline above the icon primitives (camera
    // sits on +Z). One step closer than the resize handles' -0.02 so
    // the corner handles still paint on top of the outline.
    const z = -0.01;
    const points = [
      new Vector3(x0, y0, z),
      new Vector3(x1, y0, z),
      new Vector3(x1, y1, z),
      new Vector3(x0, y1, z),
      new Vector3(x0, y0, z),
    ];
    const line = CreateGreasedLine(
      "om-selection-outline",
      { points },
      {
        width: this.widthPx,
        sizeAttenuation: true,
        color: this.color,
      },
      this.scene,
    );
    line.parent = this.parent;
    line.isPickable = false;
    line.isVisible = false;
    return line;
  }

  /** Rebuild geometry after the icon extent changes. */
  resize(
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
  ): void {
    const wasVisible = this.line.isVisible;
    this.line.dispose();
    this.line = this.build(iconWidth, iconHeight, iconCx, iconCy);
    this.line.isVisible = wasVisible;
    if (wasVisible) {
      requestSceneRender(this.scene);
    }
  }

  setVisible(visible: boolean): void {
    if (this.line.isVisible === visible) {
      return;
    }
    this.line.isVisible = visible;
    requestSceneRender(this.scene);
  }

  dispose(): void {
    this.line.dispose();
  }
}

/**
 * Four corner resize handles for a single shape node. Sized in screen
 * pixels (kept constant by `rescale()`, which the host calls whenever
 * the view's zoom/aspect changes — see `OmShapeElement`'s view-state
 * subscription).
 */
export class ResizeHandles {
  private readonly handles: Mesh[] = [];
  private readonly material: StandardMaterial;
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
  }

  setVisible(visible: boolean): void {
    this.currentVisible = visible;
    for (const h of this.handles) {
      h.isVisible = visible;
    }
    if (visible) {
      this.rescale();
    }
    requestSceneRender(this.scene);
  }

  isVisible(): boolean {
    return this.currentVisible;
  }

  dispose(): void {
    for (const h of this.handles) {
      h.dispose();
    }
    this.handles.length = 0;
    this.material.dispose();
  }

  /**
   * Resize handles to a constant screen-pixel size given the camera's
   * current orthographic extents. Call after any change that affects
   * `worldPerPixel` — zoom or canvas resize. No-op while invisible.
   */
  rescale(): void {
    if (!this.currentVisible) {
      return;
    }
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

/**
 * Live rubber-band selection rectangle. Drawn directly in diagram
 * coordinates (the scene's world units), so the host feeds it the same
 * `rect` the `DragController` emits without any client-pixel
 * conversion. A translucent fill plane plus a `GreasedLine` border —
 * the fill makes the swept area legible over a dense field of icons,
 * the border keeps the edge crisp at any zoom.
 *
 * Sits very close to the camera (`-Z`) so it paints on top of every
 * entity and the resize handles. `setRect(null)` hides it between
 * drags without disposing — a rubber-band drag re-shows it on the next
 * pointermove.
 */
export class RubberBandOverlay {
  private fill: Mesh | null = null;
  private border: AbstractMesh | null = null;
  private readonly fillMaterial: StandardMaterial;
  private rect: DiagramRect | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
    private readonly color: Color3 = new Color3(0.38, 0.6, 0.98),
    private readonly z: number = -0.03,
  ) {
    this.fillMaterial = new StandardMaterial("om-rubberband-fill", scene);
    this.fillMaterial.disableLighting = true;
    this.fillMaterial.emissiveColor = this.color;
    this.fillMaterial.alpha = 0.12;
  }

  /** Update the band to `rect`, or hide it when `rect` is `null`. */
  setRect(rect: DiagramRect | null): void {
    this.rect = rect;
    this.rebuild();
    requestSceneRender(this.scene);
  }

  dispose(): void {
    this.fill?.dispose();
    this.border?.dispose();
    this.fill = null;
    this.border = null;
    this.fillMaterial.dispose();
  }

  private rebuild(): void {
    this.fill?.dispose();
    this.border?.dispose();
    this.fill = null;
    this.border = null;
    const rect = this.rect;
    if (!rect) {
      return;
    }
    const { x1: x0, x2: x1, y1: y0, y2: y1 } = normaliseRect(rect);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) {
      // A zero-area band has no geometry to build.
      return;
    }
    const fill = MeshBuilder.CreatePlane(
      "om-rubberband",
      { width: w, height: h },
      this.scene,
    );
    fill.material = this.fillMaterial;
    fill.isPickable = false;
    fill.position.set(x0 + w / 2, y0 + h / 2, this.z);
    if (this.parent) {
      fill.parent = this.parent;
    }
    this.fill = fill;

    const points = [
      new Vector3(x0, y0, this.z),
      new Vector3(x1, y0, this.z),
      new Vector3(x1, y1, this.z),
      new Vector3(x0, y1, this.z),
      new Vector3(x0, y0, this.z),
    ];
    const border = CreateGreasedLine(
      "om-rubberband-border",
      { points },
      { width: 2, sizeAttenuation: true, color: this.color },
      this.scene,
    );
    border.isPickable = false;
    if (this.parent) {
      border.parent = this.parent;
    }
    this.border = border;
  }
}
