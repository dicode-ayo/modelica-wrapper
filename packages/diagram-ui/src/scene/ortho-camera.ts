import {
  Vector3,
  type ArcRotateCamera,
  type Camera,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";

/**
 * Narrows to an orthographic `ArcRotateCamera` by the presence of
 * `orthoLeft`, which only the ortho projection populates.
 */
export function isOrthoCamera(
  cam: Camera | null | undefined,
): cam is ArcRotateCamera {
  return cam != null && (cam as ArcRotateCamera).orthoLeft !== undefined;
}

/** The active camera when it is orthographic, else `null`. */
export function findOrthoCamera(scene: Scene): ArcRotateCamera | null {
  const cam = scene.activeCamera;
  return isOrthoCamera(cam) ? cam : null;
}

/**
 * Absolute world-space scale of a node. Meshes parented to a shape's
 * transform carry the icon→placement scale (commonly ≪ 1); divide a
 * screen-constant size by this to resolve it through that scale. A flip
 * negates an axis; magnitude is what matters, so the sign is dropped.
 */
export function worldScaleXY(node: TransformNode): { x: number; y: number } {
  const scale = new Vector3();
  node.computeWorldMatrix(true).decompose(scale, undefined, undefined);
  return { x: Math.abs(scale.x) || 1, y: Math.abs(scale.y) || 1 };
}
