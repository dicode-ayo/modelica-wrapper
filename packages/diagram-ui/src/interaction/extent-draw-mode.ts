import type { Extent } from "@dicode/omc-client";

import type {
  DiagramPoint,
  DragEmit,
  GestureMode,
  GestureStart,
} from "./gesture-mode.js";
import type { DrawKind } from "./tools.js";

/** Normalized drag box, corners ordered `[[minX, minY], [maxX, maxY]]`. */
function extentOf(a: DiagramPoint, b: DiagramPoint): Extent {
  return [
    [Math.min(a.x, b.x), Math.min(a.y, b.y)],
    [Math.max(a.x, b.x), Math.max(a.y, b.y)],
  ];
}

/** Minimum drag span, in diagram units, that counts as a draw vs a click. */
const MIN_DRAW_SPAN = 1;

/** A click (or a hair of movement) shouldn't create a zero-size shape. */
function degenerate(e: Extent): boolean {
  return (
    Math.abs(e[1][0] - e[0][0]) < MIN_DRAW_SPAN ||
    Math.abs(e[1][1] - e[0][1]) < MIN_DRAW_SPAN
  );
}

/**
 * Draws a new extent primitive (rectangle / ellipse) by press-drag-release.
 * Emits the live drag box as `drawShape` events; the host builds the actual
 * `Shape`, previews it via `draftLayout`, and commits + persists it on release.
 * The preview *is* the real primitive — this mode owns no overlay mesh.
 *
 * The router only routes a press here while a draw tool is armed, so `begin`
 * claims the gesture whatever is underneath (you draw over components too).
 */
export class ExtentDrawMode implements GestureMode {
  readonly id = "draw";
  private start: DiagramPoint | null = null;
  private kind: DrawKind | null = null;

  constructor(
    private readonly emit: DragEmit,
    private readonly getKind: () => DrawKind | null,
  ) {}

  cancel(): void {
    this.start = null;
    this.kind = null;
  }

  begin(start: GestureStart): boolean {
    const kind = this.getKind();
    if (!kind) {
      return false;
    }
    this.kind = kind;
    this.start = { x: start.point.x, y: start.point.y };
    return true;
  }

  update(point: DiagramPoint): void {
    if (!this.start || !this.kind) {
      return;
    }
    this.emit("drawShape", {
      kind: this.kind,
      extent: extentOf(this.start, point),
      draft: true,
    });
  }

  commit(point: DiagramPoint): void {
    if (!this.start || !this.kind) {
      return;
    }
    const extent = extentOf(this.start, point);
    const kind = this.kind;
    this.start = null;
    this.kind = null;
    this.emit("drawShape", {
      kind,
      extent: degenerate(extent) ? null : extent,
      draft: false,
    });
  }
}
