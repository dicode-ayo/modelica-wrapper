import type { Point } from "@dicode/omc-client";

import type { DiagramPoint } from "./gesture-mode.js";
import { buildPolyShape } from "./shape-build.js";
import { PolylineDrawing } from "./polyline-drawing.js";
import { snapPoint, type SnapGrid } from "./snap-math.js";
import type { ToolEmit, ToolMode } from "./tool-mode.js";
import type { PolyKind } from "./tools.js";

/**
 * Diagram-unit close-tolerance radius used only when grid snapping is off;
 * with a grid the tolerance is half a cell instead (see `closesAt`).
 */
const POLY_CLOSE_FALLBACK = 1;

/**
 * Draws a poly primitive (line / polygon) by multi-click: one vertex per
 * primary click, a rubber segment from the last vertex to the cursor, and
 * finish on double-click, Enter, or a click back on the start vertex.
 * Backspace drops the last vertex; Escape cancels. Owns the pure
 * {@link PolylineDrawing} machine, snaps every point to the active grid, and
 * emits `ToolDraw` steps the host turns into a `draftLayout` preview and the
 * committed graphic.
 */
export class MultiClickToolMode implements ToolMode {
  readonly pressDrag = false;
  private readonly draw = new PolylineDrawing();

  constructor(
    private readonly emit: ToolEmit,
    private readonly getKind: () => PolyKind | null,
    private readonly getSnapGrid: () => SnapGrid,
  ) {}

  get active(): boolean {
    return this.draw.active;
  }

  press(point: DiagramPoint): void {
    const kind = this.getKind();
    if (!kind) {
      return;
    }
    const at = this.snap(point);
    if (!this.draw.active) {
      this.draw.start(kind, at);
    } else if (this.closesAt(at)) {
      this.finish();
      return;
    } else {
      this.draw.addVertex(at);
    }
    this.emitDraft();
  }

  move(point: DiagramPoint): void {
    if (!this.draw.active) {
      return;
    }
    this.draw.moveCursor(this.snap(point));
    this.emitDraft();
  }

  release(): void {
    // Poly draws commit on click / double-click / keyboard, never on release.
  }

  finish(): void {
    const result = this.draw.finish();
    if (result) {
      this.emit({
        phase: "commit",
        shape: buildPolyShape(result.kind, result.points),
      });
    } else {
      this.emit({ phase: "cancel" });
    }
  }

  key(e: KeyboardEvent): boolean {
    if (!this.draw.active) {
      return false;
    }
    if (e.key === "Enter") {
      this.finish();
      return true;
    }
    if (e.key === "Backspace") {
      this.draw.undoVertex();
      if (this.draw.active) {
        this.emitDraft();
      } else {
        // Last vertex removed — the gesture ended but the tool stays armed.
        this.emit({ phase: "cancel" });
      }
      return true;
    }
    if (e.key === "Escape") {
      this.draw.cancel();
      this.emit({ phase: "cancel" });
      return true;
    }
    return false;
  }

  cancel(): void {
    if (this.draw.active) {
      this.draw.cancel();
      this.emit({ phase: "cancel" });
    }
  }

  private emitDraft(): void {
    const points = this.draw.draftPoints();
    const kind = this.draw.drawKind;
    if (!points || !kind) {
      return;
    }
    // A polygon needs ≥3 points to render; while only the first segment is
    // drawn (≤2 points) preview it as a line so the initial drag is visible —
    // a 2-point polygon would collapse to a back-and-forth invisible sliver.
    const previewKind = kind === "polygon" && points.length < 3 ? "line" : kind;
    this.emit({ phase: "draft", shape: buildPolyShape(previewKind, points) });
  }

  private snap(point: DiagramPoint): Point {
    const s = snapPoint(point.x, point.y, this.getSnapGrid());
    return [s.x, s.y];
  }

  /** A finishable gesture closes when a click lands on the start vertex. */
  private closesAt(at: Point): boolean {
    const first = this.draw.firstVertex();
    if (!first || !this.draw.canFinish()) {
      return false;
    }
    // Half a grid cell: a click that snaps back to the start cell matches it
    // exactly while an adjacent cell stays outside. No grid → fixed fallback.
    const [gx, gy] = this.getSnapGrid();
    const cell = Math.max(gx, gy);
    const tol = cell > 0 ? cell / 2 : POLY_CLOSE_FALLBACK;
    return (
      Math.abs(at[0] - first[0]) <= tol && Math.abs(at[1] - first[1]) <= tol
    );
  }
}
