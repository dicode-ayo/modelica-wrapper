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

import type { Point } from "@dicode/omc-client";

import { requestSceneRender } from "../scene/render-scheduler.js";
import { findOrthoCamera, worldScaleXY } from "../scene/ortho-camera.js";
import { worldPerPixel } from "../scene/text-resolution.js";
import type { EntityKind } from "../interaction/node-keys.js";

/** Accent blue shared by the selection outline stroke and rotate handle. */
const SELECTION_BLUE = new Color3(0.38, 0.6, 0.98);
/** Near-black of a poly vertex dot — matches the connection junction disc. */
const VERTEX_DOT_COLOR = new Color3(0.1, 0.1, 0.18);
/** Vertex-dot radius in diagram units — matches the connection waypoint disc
 *  (and the hit tube) so the dot is a real grab target that grows with zoom,
 *  not a hard-to-hit screen-pixel speck the line-body drag wins over. */
const VERTEX_DOT_RADIUS = 1.5;

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
    private color: Color3 = SELECTION_BLUE,
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
 * Scales `meshes` to a constant screen-pixel size given the camera's current
 * orthographic extents, dividing out the parent's world scale so the size is
 * the same whatever frame the handles hang in. Shared by every handle class.
 */
function rescaleToPixels(
  scene: Scene,
  parent: TransformNode,
  meshes: ReadonlyArray<Mesh>,
  pixelSize: number,
  camera: ArcRotateCamera | null,
): void {
  const cam = camera ?? findOrthoCamera(scene);
  if (!cam) {
    return;
  }
  const wpp = worldPerPixel(
    cam.orthoLeft ?? -1,
    cam.orthoRight ?? 1,
    scene.getEngine().getRenderWidth() || 1,
  );
  const size = pixelSize * wpp;
  const s = worldScaleXY(parent);
  for (const m of meshes) {
    m.scaling.set(size / s.x, size / s.y, 1);
  }
}

/**
 * Four corner resize handles for a single shape node. Sized in screen
 * pixels (kept constant by `rescale()`, which the host calls on every
 * view change — zoom or pan).
 */
export class ResizeHandles {
  private readonly handles: Mesh[] = [];
  private readonly material: StandardMaterial;
  private currentVisible = false;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
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
    if (this.currentVisible) {
      rescaleToPixels(
        this.scene,
        this.parent,
        this.handles,
        this.handlePixelSize,
        this.camera,
      );
    }
  }
}

/**
 * Gap between a shape's top edge and the rotate disc's centre, as a
 * fraction of the icon height. Icon-relative (not screen-pixel) so the
 * disc tracks the component as it scales with zoom — matching how the
 * corner resize handles stay glued to the icon's corners.
 */
const ROTATE_HANDLE_GAP_FRACTION = 0.2;

/**
 * Single rotate affordance for a shape node. A pickable disc floating
 * just above the shape's top edge. Picking it starts a rotate-drag
 * gesture (see `DragController`'s rotate branch); the mesh carries
 * `metadata.kind = "rotate-handle"` so the picker walks up to the
 * owning shape.
 *
 * The disc is sized in screen pixels (kept constant by `rescale()`), but
 * its gap above the edge is icon-relative so it scales with the component.
 */
export class RotateHandle {
  private readonly handle: Mesh;
  private readonly material: StandardMaterial;
  private currentVisible = false;
  private readonly topEdgeY: number;
  private readonly anchorX: number;
  private readonly gapLocal: number;

  // Signature mirrors ResizeHandles / SelectionOutline so OmShapeNode
  // constructs all three identically; the single top-centre handle
  // doesn't need the width.
  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
    _iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
    private readonly handlePixelSize: number = 10,
    private readonly camera: ArcRotateCamera | null = null,
  ) {
    this.material = new StandardMaterial("om-rotate-handle-mat", scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = SELECTION_BLUE;

    this.topEdgeY = iconCy + iconHeight / 2;
    this.anchorX = iconCx;
    this.gapLocal = iconHeight * ROTATE_HANDLE_GAP_FRACTION;

    this.handle = MeshBuilder.CreateDisc(
      "om-rotate-handle",
      { radius: 0.5, tessellation: 24 },
      scene,
    );
    this.handle.material = this.material;
    this.handle.parent = parent;
    this.handle.position.set(
      this.anchorX,
      this.topEdgeY + this.gapLocal,
      -0.02,
    );
    this.handle.isVisible = false;
    this.handle.isPickable = true;
    // nodeId is inert here — `entityKeyForNode` resolves the owning shape
    // by walking the parent chain, so any value works.
    this.handle.metadata = {
      kind: "rotate-handle" satisfies EntityKind,
      nodeId: "rotate",
    };
  }

  setVisible(visible: boolean): void {
    this.currentVisible = visible;
    this.handle.isVisible = visible;
    if (visible) {
      this.rescale();
    }
    requestSceneRender(this.scene);
  }

  isVisible(): boolean {
    return this.currentVisible;
  }

  dispose(): void {
    this.handle.dispose();
    this.material.dispose();
  }

  /**
   * Size the disc to a constant screen-pixel diameter given the camera's
   * current orthographic extents. The gap above the edge is icon-relative
   * and fixed at construction, so only the diameter tracks zoom. No-op
   * while invisible.
   */
  rescale(): void {
    if (this.currentVisible) {
      rescaleToPixels(
        this.scene,
        this.parent,
        [this.handle],
        this.handlePixelSize,
        this.camera,
      );
    }
  }
}

/**
 * Per-vertex drag handles for a poly (line / polygon) shape. One small
 * pickable disc sits on each vertex; picking one starts a vertex-drag
 * gesture. Each carries `metadata.kind = "vertex-handle"` and a
 * self-describing `nodeId` of `${ownerId}/${vertexIndex}` (e.g. `line:1/2`).
 * Positions are the shape's own `points` — valid only because a poly host
 * shape uses an identity diagram frame (the parent transform sits at the
 * shape origin, unscaled), so a point coordinate is already the handle's
 * local position.
 */
export class VertexHandles {
  private readonly handles: Mesh[] = [];
  private readonly material: StandardMaterial;
  private currentVisible = false;

  constructor(
    private readonly scene: Scene,
    parent: TransformNode,
    points: ReadonlyArray<Point>,
    ownerId: string,
  ) {
    this.material = new StandardMaterial("om-vertex-handle-mat", scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = VERTEX_DOT_COLOR;

    points.forEach(([x, y], i) => {
      // Diagram-unit disc matching the connection junction — a grab target
      // that scales with zoom (the entity's poly frame is unscaled).
      const handle = MeshBuilder.CreateDisc(
        "om-vertex-handle",
        { radius: VERTEX_DOT_RADIUS, tessellation: 16 },
        scene,
      );
      handle.material = this.material;
      handle.parent = parent;
      // Negative z = toward the camera (at -Z), so dots paint over the shape.
      handle.position.set(x, y, -0.02);
      handle.isVisible = false;
      handle.isPickable = true;
      handle.metadata = {
        kind: "vertex-handle" satisfies EntityKind,
        nodeId: `${ownerId}/${i}`,
      };
      this.handles.push(handle);
    });
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

  /** No-op: the dots are diagram-sized, so they track zoom on their own. */
  rescale(): void {}
}
