import type { Point } from "@dicode/omc-client";

import type { PolyKind } from "./tools.js";

/**
 * The in-progress state of a multi-click poly draw (Line / Polygon). One
 * vertex is placed per click; a rubber segment runs from the last placed
 * vertex to the live cursor. The host drives it from pointer + keyboard
 * events, snaps each point, and renders the draft / commits the result.
 *
 * Pure and self-contained: it owns no DOM and no rendering. `start` arms a
 * gesture, `addVertex` / `undoVertex` edit the vertex list, `moveCursor`
 * tracks the rubber endpoint, `finish` ends the gesture into a shape (or
 * `null` when there are too few vertices), and `cancel` abandons it.
 */

/** Minimum distinct vertices a kind needs to commit into a real shape. */
const MIN_VERTICES: Record<PolyKind, number> = { line: 2, polygon: 3 };

export interface PolyResult {
  kind: PolyKind;
  points: Point[];
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export class PolylineDrawing {
  private kind: PolyKind | null = null;
  private vertices: Point[] = [];
  private cursor: Point | null = null;

  /** True while a gesture is in flight (a kind has been armed via `start`). */
  get active(): boolean {
    return this.kind !== null;
  }

  get drawKind(): PolyKind | null {
    return this.kind;
  }

  get vertexCount(): number {
    return this.vertices.length;
  }

  /** The first placed vertex, for the host's click-to-close hit test. */
  firstVertex(): Point | null {
    return this.vertices[0] ?? null;
  }

  /** Begin a gesture of `kind` with its first vertex at `at`. */
  start(kind: PolyKind, at: Point): void {
    this.kind = kind;
    this.vertices = [at];
    this.cursor = at;
  }

  /** Track the rubber-band endpoint; a no-op when no gesture is active. */
  moveCursor(at: Point): void {
    if (this.kind !== null) {
      this.cursor = at;
    }
  }

  /**
   * Place a vertex. A click that lands exactly on the previous vertex is
   * ignored so a double-click (finish) doesn't also drop a zero-length
   * segment. A no-op when no gesture is active.
   */
  addVertex(at: Point): void {
    if (this.kind === null) {
      return;
    }
    const last = this.vertices.at(-1);
    if (last !== undefined && samePoint(last, at)) {
      return;
    }
    this.vertices.push(at);
    this.cursor = at;
  }

  /** Drop the last placed vertex; cancels the gesture when none remain. */
  undoVertex(): void {
    if (this.kind === null) {
      return;
    }
    this.vertices.pop();
    if (this.vertices.length === 0) {
      this.cancel();
    }
  }

  /** Whether the gesture has enough vertices to commit into a shape. */
  canFinish(): boolean {
    return (
      this.kind !== null && this.vertices.length >= MIN_VERTICES[this.kind]
    );
  }

  /**
   * Live preview vertices: the placed vertices plus the rubber cursor. The
   * polygon's closing edge back to the first vertex is left to the renderer
   * (it auto-closes), so the trailing cursor is the only extra point.
   * `null` when no gesture is active.
   */
  draftPoints(): Point[] | null {
    if (this.kind === null) {
      return null;
    }
    const last = this.vertices.at(-1);
    if (
      this.cursor !== null &&
      (last === undefined || !samePoint(last, this.cursor))
    ) {
      return [...this.vertices, this.cursor];
    }
    return [...this.vertices];
  }

  /**
   * End the gesture. Returns the committed shape when there are enough
   * vertices, otherwise `null`. Either way the gesture is reset.
   */
  finish(): PolyResult | null {
    if (!this.canFinish() || this.kind === null) {
      this.cancel();
      return null;
    }
    const result: PolyResult = { kind: this.kind, points: [...this.vertices] };
    this.cancel();
    return result;
  }

  /** Abandon the gesture without committing. */
  cancel(): void {
    this.kind = null;
    this.vertices = [];
    this.cursor = null;
  }
}
