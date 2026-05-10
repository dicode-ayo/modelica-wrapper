/**
 * Pure view-math used by `<om-scene>` and its `PanZoom` helper. No
 * Babylon, no DOM — just maps between viewport pixel coordinates and
 * diagram coordinates given the current view state.
 *
 * View state is described by:
 *   - `zoom`   — diagram-space half-height of the visible region
 *   - `panX`   — diagram x of the screen centre
 *   - `panY`   — diagram y of the screen centre
 *   - canvas pixel dimensions
 *
 * Coordinate convention (matches `<om-scene>`):
 *   - diagram +x maps to screen right
 *   - diagram +y maps to screen up (canvas pixel y is flipped)
 */

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface DiagramPoint {
  x: number;
  y: number;
}

/** Converts a viewport pixel coordinate to diagram space. */
export function clientToDiagram(
  view: ViewState,
  canvas: CanvasSize,
  clientX: number,
  clientY: number,
): DiagramPoint {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { x: view.panX, y: view.panY };
  }
  const aspect = canvas.width / canvas.height;
  const halfH = view.zoom;
  const halfW = halfH * aspect;
  const x = view.panX + ((clientX - canvas.width / 2) * 2 * halfW) / canvas.width;
  const y =
    view.panY + ((canvas.height / 2 - clientY) * 2 * halfH) / canvas.height;
  return { x, y };
}

/** Converts a diagram coordinate to a viewport pixel coordinate. */
export function diagramToClient(
  view: ViewState,
  canvas: CanvasSize,
  diagramX: number,
  diagramY: number,
): { x: number; y: number } {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { x: 0, y: 0 };
  }
  const aspect = canvas.width / canvas.height;
  const halfH = view.zoom;
  const halfW = halfH * aspect;
  const x = canvas.width / 2 + ((diagramX - view.panX) * canvas.width) / (2 * halfW);
  const y =
    canvas.height / 2 - ((diagramY - view.panY) * canvas.height) / (2 * halfH);
  return { x, y };
}

/**
 * Returns the new (`panX`, `panY`) that keeps the diagram point under
 * the cursor in place when applying a pointer drag of (dx, dy) pixels.
 */
export function applyPanDelta(
  view: ViewState,
  canvas: CanvasSize,
  dx: number,
  dy: number,
): { panX: number; panY: number } {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { panX: view.panX, panY: view.panY };
  }
  const aspect = canvas.width / canvas.height;
  const halfH = view.zoom;
  const halfW = halfH * aspect;
  const panX = view.panX - (dx * 2 * halfW) / canvas.width;
  const panY = view.panY + (dy * 2 * halfH) / canvas.height;
  return { panX, panY };
}

/**
 * Returns the new view state after applying a wheel zoom around the
 * given screen pixel coordinate. `factor < 1` zooms in (shrinks the
 * visible region), `factor > 1` zooms out.
 */
export function applyZoomAroundCursor(
  view: ViewState,
  canvas: CanvasSize,
  cursorX: number,
  cursorY: number,
  factor: number,
  bounds: { min: number; max: number },
): ViewState {
  const newZoom = clamp(view.zoom * factor, bounds.min, bounds.max);
  if (newZoom === view.zoom || canvas.width <= 0 || canvas.height <= 0) {
    return { ...view, zoom: newZoom };
  }
  const aspect = canvas.width / canvas.height;
  const oldHalfH = view.zoom;
  const newHalfH = newZoom;
  const oldHalfW = oldHalfH * aspect;
  const newHalfW = newHalfH * aspect;

  const panX =
    view.panX +
    ((cursorX - canvas.width / 2) * 2 * (oldHalfW - newHalfW)) / canvas.width;
  const panY =
    view.panY +
    ((canvas.height / 2 - cursorY) * 2 * (oldHalfH - newHalfH)) / canvas.height;
  return { zoom: newZoom, panX, panY };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
