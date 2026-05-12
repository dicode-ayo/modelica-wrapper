/**
 * Shared diagram constants.
 *
 * Layout space is Modelica-native: `{{-100,-100},{100,100}}` for the
 * default `coordinateSystem.extent`, with origin at centre. The renderer
 * works in those units directly — no normalisation to 0–1000 like the
 * legacy dyad-ui port. The diagram occupies the XZ plane of the Babylon
 * scene (`y = 0`) so a future MultiBody view can layer 3D meshes above
 * the diagram without coordinate gymnastics.
 *
 * Diagram coordinate (x, y)  →  world position (x, 0, y).
 */

/** Default coordinate-system half-extent when the source omits it. */
export const DEFAULT_EXTENT_HALF = 100;

/** Initial camera radius (zoom distance) — same units as the diagram. */
export const DEFAULT_CAMERA_RADIUS = 300;

/** Pixel size used as a fallback before ResizeObserver fires. */
export const FALLBACK_CANVAS_WIDTH = 800;
export const FALLBACK_CANVAS_HEIGHT = 600;

/** Babylon `Camera.ORTHOGRAPHIC_CAMERA` mode constant; re-exported so the
 *  scene component doesn't pull `Camera` in unless it actually needs it. */
export const CAMERA_MODE_ORTHO = 1;
