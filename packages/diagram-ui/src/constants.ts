/**
 * Shared diagram constants.
 *
 * Layout space is Modelica-native: `{{-100,-100},{100,100}}` for the
 * default `coordinateSystem.extent`, with origin at centre. The renderer
 * works in those units directly — no normalisation to 0–1000.
 *
 * Diagram coordinate (x, y) maps to CSS pixels via the scene's view
 * transform (`scene.component.ts`); +x is screen right, +y is screen up.
 */

/** Default coordinate-system half-extent when the source omits it. */
export const DEFAULT_EXTENT_HALF = 100;

/** Pixel size used as a fallback before ResizeObserver fires. */
export const FALLBACK_CANVAS_WIDTH = 800;
export const FALLBACK_CANVAS_HEIGHT = 600;
