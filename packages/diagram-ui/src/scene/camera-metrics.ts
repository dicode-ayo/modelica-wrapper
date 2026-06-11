import type { ArcRotateCamera, Scene } from "@babylonjs/core";

import { worldPerPixel } from "./line-metrics.js";

/**
 * The scene's orthographic camera, or `null` when the active camera
 * isn't an ortho camera (e.g. headless tests that never set one up).
 * Identified structurally by the presence of `orthoLeft` so callers
 * don't import the concrete camera type just to narrow.
 */
export function findOrthoCamera(scene: Scene): ArcRotateCamera | null {
  const cam = scene.activeCamera;
  if (cam && (cam as ArcRotateCamera).orthoLeft !== undefined) {
    return cam as ArcRotateCamera;
  }
  return null;
}

/**
 * Diagram units per device pixel for a given orthographic camera, or the
 * scene's active ortho camera when `camera` is null. Returns `null` when
 * there's no ortho camera to measure against, letting callers keep their
 * last-known sizing rather than snap to a fallback.
 */
export function cameraWorldPerPixel(
  scene: Scene,
  camera: ArcRotateCamera | null,
): number | null {
  const cam = camera ?? findOrthoCamera(scene);
  if (!cam) {
    return null;
  }
  const canvasW = scene.getEngine().getRenderWidth() || 1;
  const orthoRight = cam.orthoRight ?? 1;
  const orthoLeft = cam.orthoLeft ?? -1;
  return worldPerPixel(orthoLeft, orthoRight, canvasW);
}

/**
 * Diagram units per device pixel for the scene's current orthographic
 * view.
 */
export function sceneWorldPerPixel(scene: Scene): number | null {
  return cameraWorldPerPixel(scene, null);
}
