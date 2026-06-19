import type {
  DiagramPoint,
  DragEmit,
  GestureMode,
  GestureStart,
} from "./gesture-mode.js";

/**
 * Area selection: a drag on empty canvas rubber-bands out a rectangle.
 * Click-select and hover are not part of this mode — they run always in
 * the `InteractionManager`, underneath every gesture.
 */
export class SelectMode implements GestureMode {
  readonly id = "select";
  private start: DiagramPoint | null = null;

  constructor(private readonly emit: DragEmit) {}

  begin(start: GestureStart): boolean {
    if (start.entity) {
      return false;
    }
    this.start = { x: start.point.x, y: start.point.y };
    this.emit("rubberBand", {
      rect: {
        x1: start.point.x,
        y1: start.point.y,
        x2: start.point.x,
        y2: start.point.y,
      },
      draft: true,
    });
    return true;
  }

  update(point: DiagramPoint): void {
    if (this.start) {
      this.emit("rubberBand", {
        rect: { x1: this.start.x, y1: this.start.y, x2: point.x, y2: point.y },
        draft: true,
      });
    }
  }

  commit(point: DiagramPoint): void {
    if (!this.start) {
      return;
    }
    const s = this.start;
    this.start = null;
    this.emit("rubberBand", {
      rect: { x1: s.x, y1: s.y, x2: point.x, y2: point.y },
      draft: false,
    });
  }
}
