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
  /** Multiplicative zoom step per wheel tick (>1 zooms out). */
  zoomStep: number;
}

export const DEFAULT_PAN_ZOOM_BOUNDS: PanZoomBounds = { min: 1, max: 5000 };
export const DEFAULT_ZOOM_STEP = 1.1;

/**
 * Owns the pointer / wheel listeners on the scene's canvas and turns
 * them into `ViewState` changes. Renderer-agnostic — talks to
 * `<om-scene>` only through `getView` / `onViewChange`.
 *
 * Bindings:
 *   - wheel        → zoom around cursor
 *   - middle drag  → pan
 *   - shift + left → pan
 *
 * Plain left-drag is reserved for the future interaction manager
 * (selection / move). Right-drag stays available for context menu.
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
    // The browser scrolls the parent if the canvas is fully inside a
    // scrollable region; that breaks ctrl/cmd wheel for zoom too.
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
    const rect = this.canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? this.zoomStep : 1 / this.zoomStep;
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
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (!isPanGesture(e)) {
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
    // Block the browser context menu so a future right-click handler
    // can drive an in-app context menu instead.
    e.preventDefault();
  };
}

function isPanGesture(e: PointerEvent): boolean {
  // Middle button: bitmask test against `buttons` since `button` is 1
  // for middle in PointerEvent.
  if (e.button === 1) {
    return true;
  }
  // Shift + primary button.
  if (e.button === 0 && e.shiftKey) {
    return true;
  }
  return false;
}
