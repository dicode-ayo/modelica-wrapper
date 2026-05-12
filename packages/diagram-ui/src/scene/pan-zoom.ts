import {
  applyPanDelta,
  applyZoomAroundCursor,
  type ViewState,
} from "./view-math.js";

export interface PanZoomBounds {
  min: number;
  max: number;
}

export interface PanZoomOptions {
  bounds: PanZoomBounds;
  /**
   * Reference multiplicative zoom step (per ~100 px of wheel deltaY).
   * Touchpad pinch events arrive with small deltaY values so we scale
   * by `|deltaY| / 100` to keep zoom smooth on trackpads while still
   * giving a meaningful jump on a discrete mouse wheel tick.
   */
  zoomStep: number;
}

export const DEFAULT_PAN_ZOOM_BOUNDS: PanZoomBounds = { min: 1, max: 5000 };
export const DEFAULT_ZOOM_STEP = 1.1;

/**
 * Owns the pointer / wheel listeners on the scene's canvas. Touchpad-
 * friendly bindings, matching the Figma-style convention used in the
 * dyad-ui Pixi renderer:
 *
 *   - plain wheel             → pan       (2-finger touchpad scroll)
 *   - ctrl / meta + wheel     → zoom      (browsers send `ctrlKey=true`
 *                                          for trackpad pinch)
 *   - middle (or any non-primary) mouse button drag → pan
 *
 * The primary mouse button stays available for the interaction layer
 * (selection / move) and the right button stays available for the
 * in-app context menu. We swallow the browser's default context menu
 * so the host can wire its own.
 */
export class PanZoom {
  private readonly canvas: HTMLCanvasElement;
  private readonly getView: () => ViewState;
  private readonly onViewChange: (next: ViewState) => void;
  private readonly bounds: PanZoomBounds;
  private readonly zoomStep: number;

  private isPanning = false;
  private lastClientX = 0;
  private lastClientY = 0;
  private panPointerId = -1;

  constructor(
    canvas: HTMLCanvasElement,
    getView: () => ViewState,
    onViewChange: (next: ViewState) => void,
    options: Partial<PanZoomOptions> = {},
  ) {
    this.canvas = canvas;
    this.getView = getView;
    this.onViewChange = onViewChange;
    this.bounds = options.bounds ?? DEFAULT_PAN_ZOOM_BOUNDS;
    this.zoomStep = options.zoomStep ?? DEFAULT_ZOOM_STEP;
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);
    canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  destroy(): void {
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
    if (this.isPanning && this.panPointerId >= 0) {
      try {
        this.canvas.releasePointerCapture(this.panPointerId);
      } catch {
        // pointer already released
      }
    }
  }

  private readonly handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (isZoomWheel(e)) {
      this.applyWheelZoom(e);
    } else {
      this.applyWheelPan(e);
    }
  };

  private applyWheelZoom(e: WheelEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = wheelZoomFactor(e, this.zoomStep);
    const view = this.getView();
    const next = applyZoomAroundCursor(
      view,
      { width: rect.width, height: rect.height },
      cursorX,
      cursorY,
      factor,
      this.bounds,
    );
    this.onViewChange(next);
  }

  private applyWheelPan(e: WheelEvent): void {
    // Convention: `wheel` deltaX/Y positive = scroll right / down, so
    // panning to "reveal what's right/below" means the camera target
    // moves IN THE SAME DIRECTION as the wheel delta. `applyPanDelta`
    // expects a pointer-drag delta (drag-content semantics, opposite
    // sign), so negate to convert scroll → drag.
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const view = this.getView();
    const { panX, panY } = applyPanDelta(
      view,
      { width: rect.width, height: rect.height },
      -e.deltaX,
      -e.deltaY,
    );
    this.onViewChange({ ...view, panX, panY });
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (!isPanPointer(e)) {
      return;
    }
    e.preventDefault();
    this.isPanning = true;
    this.panPointerId = e.pointerId;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // happy-dom doesn't implement pointer capture; ignore.
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (!this.isPanning || e.pointerId !== this.panPointerId) {
      return;
    }
    e.preventDefault();
    const dx = e.clientX - this.lastClientX;
    const dy = e.clientY - this.lastClientY;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    const rect = this.canvas.getBoundingClientRect();
    const view = this.getView();
    const next = applyPanDelta(
      view,
      { width: rect.width, height: rect.height },
      dx,
      dy,
    );
    this.onViewChange({ ...view, ...next });
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (!this.isPanning || e.pointerId !== this.panPointerId) {
      return;
    }
    this.isPanning = false;
    this.panPointerId = -1;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  private readonly preventContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };
}

/**
 * Wheel events are classified as "zoom" when the user holds
 * Ctrl/Meta, OR when the browser synthesises a pinch gesture. Every
 * major browser delivers pinch as a `wheel` event with `ctrlKey=true`
 * regardless of the actual keyboard state, so a single test covers
 * both cases.
 */
function isZoomWheel(e: WheelEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

/**
 * Non-primary mouse buttons (button !== 0) are the pan gesture. This
 * matches the Figma / dyad-ui convention:
 *   - middle button (1)  → primary pan
 *   - right button  (2)  → "context menu" but ALSO pans while held
 *                          (matches dyad-ui's `button !== 0`)
 *   - auxiliary  (3, 4)  → pan
 *
 * The browser context menu is suppressed so a right-drag pan doesn't
 * surface the OS menu mid-gesture.
 */
function isPanPointer(e: PointerEvent): boolean {
  return e.button !== 0;
}

/**
 * Scale the multiplicative zoom factor with `|deltaY|`. Touchpad
 * pinch events deliver many small deltaYs (often 1-10 px); a single
 * mouse-wheel notch is typically ~100 px. Using
 *
 *   factor = zoomStep ^ (|deltaY| / 100)
 *
 * keeps a mouse-wheel notch close to the historical `zoomStep` (1.1)
 * while making a slow pinch produce gentle ~1% steps.
 */
function wheelZoomFactor(e: WheelEvent, zoomStep: number): number {
  // Normalise line/page wheel modes to pixel-equivalents. Most
  // browsers/devices already emit pixel mode (deltaMode === 0).
  const pixels = normaliseDeltaY(e);
  const magnitude = Math.min(1, Math.abs(pixels) / 100);
  // deltaY < 0 (wheel up / pinch out) → zoom IN → factor < 1.
  return pixels > 0
    ? Math.pow(zoomStep, magnitude)
    : Math.pow(zoomStep, -magnitude);
}

function normaliseDeltaY(e: WheelEvent): number {
  switch (e.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return e.deltaY * 16;
    case 2: // DOM_DELTA_PAGE
      return e.deltaY * 100;
    default:
      return e.deltaY;
  }
}
