import type { Extent } from "@dicode/omc-client";

import type { DiagramPoint } from "./gesture-mode.js";
import type { ToolEmit, ToolMode } from "./tool-mode.js";
import type { ExtentKind } from "./tools.js";

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
 * Draws an extent primitive (rectangle / ellipse) by press-drag-release.
 * Emits the live drag box as `drawShape` events; the host builds the actual
 * `Shape`, previews it via `draftLayout`, and commits + persists it on
 * release. The preview *is* the real primitive — this mode owns no overlay
 * mesh. A degenerate (click, no drag) release sends `extent: null` so nothing
 * is created.
 */
export class ExtentToolMode implements ToolMode {
  readonly pressDrag = true;
  private start: DiagramPoint | null = null;
  private kind: ExtentKind | null = null;

  constructor(
    private readonly emit: ToolEmit,
    private readonly getKind: () => ExtentKind | null,
  ) {}

  get active(): boolean {
    return this.start !== null;
  }

  press(point: DiagramPoint): void {
    const kind = this.getKind();
    if (!kind) {
      return;
    }
    this.kind = kind;
    this.start = { x: point.x, y: point.y };
  }

  move(point: DiagramPoint): void {
    if (!this.start || !this.kind) {
      return;
    }
    this.emit("drawShape", {
      kind: this.kind,
      extent: extentOf(this.start, point),
      draft: true,
    });
  }

  release(point: DiagramPoint): void {
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

  finish(): void {
    // Press-drag draws have no double-click finish.
  }

  key(_e: KeyboardEvent): boolean {
    // Press-drag draws don't own the keyboard.
    return false;
  }

  cancel(): void {
    this.start = null;
    this.kind = null;
  }
}
