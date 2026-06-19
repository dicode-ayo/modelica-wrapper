import type {
  DiagramPoint,
  DragEmit,
  GestureMode,
  GestureStart,
  OverlayHandle,
} from "./gesture-mode.js";

/**
 * Area selection: a drag on empty canvas rubber-bands out a rectangle.
 * Draws the rectangle on the overlay; the host consumes the emitted
 * `rubberBand` events to update the selection. Click-select and hover
 * are not part of this mode — they run always in the `InteractionManager`,
 * underneath every gesture.
 */
export class SelectMode implements GestureMode {
  readonly id = "select";
  private start: DiagramPoint | null = null;

  constructor(
    private readonly emit: DragEmit,
    private readonly overlay: OverlayHandle,
  ) {}

  begin(start: GestureStart): boolean {
    if (start.entity) {
      return false;
    }
    this.start = { x: start.point.x, y: start.point.y };
    const rect = {
      x1: start.point.x,
      y1: start.point.y,
      x2: start.point.x,
      y2: start.point.y,
    };
    this.overlay.showRect(rect);
    this.emit("rubberBand", { rect, draft: true });
    return true;
  }

  update(point: DiagramPoint): void {
    if (this.start) {
      const rect = {
        x1: this.start.x,
        y1: this.start.y,
        x2: point.x,
        y2: point.y,
      };
      this.overlay.showRect(rect);
      this.emit("rubberBand", { rect, draft: true });
    }
  }

  commit(point: DiagramPoint): void {
    if (!this.start) {
      return;
    }
    const s = this.start;
    this.start = null;
    this.overlay.hideRect();
    this.emit("rubberBand", {
      rect: { x1: s.x, y1: s.y, x2: point.x, y2: point.y },
      draft: false,
    });
  }
}
