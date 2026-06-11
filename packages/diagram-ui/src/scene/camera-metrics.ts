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
 * Diagram units per device pixel for the scene's current orthographic
 * view. Returns `null` when there's no ortho camera to measure against,
 * letting callers keep their last-known sizing rather than snap to a
 * fallback.
 */
export function sceneWorldPerPixel(scene: Scene): number | null {
  const camera = findOrthoCamera(scene);
  if (!camera) {
    return null;
  }
  const canvasW = scene.getEngine().getRenderWidth() || 1;
  const orthoRight = camera.orthoRight ?? 1;
  const orthoLeft = camera.orthoLeft ?? -1;
  return worldPerPixel(orthoLeft, orthoRight, canvasW);
}
