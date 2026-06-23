import type { Extent } from "@dicode/omc-client";

import type { DiagramPoint } from "./gesture-mode.js";
import { buildExtentShape } from "./layout-ops.js";
import { snapExtent, type SnapGrid } from "./snap-math.js";
import type { ToolEmit, ToolMode } from "./tool-mode.js";
import type { ExtentKind } from "./tools.js";

/** Normalized drag box, corners ordered `[[minX, minY], [maxX, maxY]]`. */
function extentOf(a: DiagramPoint, b: DiagramPoint): Extent {
  return [
    [Math.min(a.x, b.x), Math.min(a.y, b.y)],
    [Math.max(a.x, b.x), Math.max(a.y, b.y)],
  ];
}

/** Drag span, in diagram units, below which a drag is treated as a click. */
const MIN_DRAW_SPAN = 1;

/** True when either side of the extent is too thin to be a real shape. */
function degenerate(e: Extent): boolean {
  return (
    Math.abs(e[1][0] - e[0][0]) < MIN_DRAW_SPAN ||
    Math.abs(e[1][1] - e[0][1]) < MIN_DRAW_SPAN
  );
}

/**
 * Draws an extent primitive (rectangle / ellipse) by press-drag-release.
 * The live drag box previews unsnapped on every move; the release snaps it to
 * the grid and commits, unless the drag is degenerate or grid-snapping
 * collapsed it onto a single line (either drops the preview and stays armed).
 * The preview *is* the real primitive — this mode owns no overlay mesh.
 */
export class ExtentToolMode implements ToolMode {
  readonly pressDrag = true;
  private start: DiagramPoint | null = null;
  private kind: ExtentKind | null = null;

  constructor(
    private readonly emit: ToolEmit,
    private readonly getKind: () => ExtentKind | null,
    private readonly getSnapGrid: () => SnapGrid,
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
    this.emit({
      phase: "draft",
      shape: buildExtentShape(this.kind, extentOf(this.start, point)),
    });
  }

  release(point: DiagramPoint): void {
    if (!this.start || !this.kind) {
      return;
    }
    const raw = extentOf(this.start, point);
    const kind = this.kind;
    this.start = null;
    this.kind = null;
    if (degenerate(raw)) {
      this.emit({ phase: "cancel" });
      return;
    }
    const snapped = snapExtent(raw, this.getSnapGrid());
    // Grid-snapping can collapse a thin drag onto one grid line; don't
    // persist a zero-size shape.
    if (snapped[0][0] === snapped[1][0] || snapped[0][1] === snapped[1][1]) {
      this.emit({ phase: "cancel" });
      return;
    }
    this.emit({ phase: "commit", shape: buildExtentShape(kind, snapped) });
  }

  finish(): void {
    // Press-drag draws have no double-click finish.
  }

  key(_e: KeyboardEvent): boolean {
    // Press-drag draws don't own the keyboard.
    return false;
  }

  cancel(): void {
    const cancelling = this.start !== null;
    this.start = null;
    this.kind = null;
    if (cancelling) {
      this.emit({ phase: "cancel" });
    }
  }
}
