/**
 * Framework-free state for host-mediated component placement ("press a library
 * row, drag onto the canvas, release to drop"). The library lives in a separate
 * VSCode webview iframe, so HTML5 drag can't reach the diagram canvas; instead
 * the host relays a "placement started" signal and the diagram drives its own
 * ghost from local pointer events. This module owns the armed-class + ghost-point
 * bookkeeping and the decision of what a pointer move / release means, kept out
 * of the Lit component so it can be unit-tested without a DOM.
 */

export interface PlacementPoint {
  readonly x: number;
  readonly y: number;
}

/** Client-coordinate rectangle, as returned by `getBoundingClientRect`. */
export interface ClientRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Whether a client point falls within `rect` (edges inclusive). */
export function pointInRect(x: number, y: number, rect: ClientRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Tracks a single in-flight placement. Armed with a class name, it remembers the
 * last cursor point while the cursor is over the canvas (the ghost anchor) and
 * clears it off-canvas. A release over the canvas yields the commit point and
 * disarms; a release off-canvas or an explicit reset disarms with no point.
 */
export class PlacementController {
  private className: string | null = null;
  private ghost: PlacementPoint | null = null;

  /** The armed class name, or `null` when idle. */
  get active(): string | null {
    return this.className;
  }

  /** Current ghost anchor (client coords), or `null` when idle / off-canvas. */
  get ghostPoint(): PlacementPoint | null {
    return this.className === null ? null : this.ghost;
  }

  /** Arm placement for `className`. Empty names are ignored (stays idle). */
  begin(className: string): void {
    if (className === "") return;
    this.className = className;
    this.ghost = null;
  }

  /** Disarm and drop any ghost. */
  reset(): void {
    this.className = null;
    this.ghost = null;
  }

  /**
   * Record a pointer move. Over the canvas the ghost tracks the cursor; off it
   * the ghost hides but placement stays armed. Returns the resulting ghost
   * anchor (or `null`), so the caller can drive its reactive render.
   */
  move(x: number, y: number, overCanvas: boolean): PlacementPoint | null {
    if (this.className === null) return null;
    this.ghost = overCanvas ? { x, y } : null;
    return this.ghost;
  }

  /**
   * Record a pointer release and disarm. Returns the commit point when the
   * release landed over the canvas, else `null` (cancel). The armed class name
   * is available via {@link active} until this returns.
   */
  release(x: number, y: number, overCanvas: boolean): PlacementPoint | null {
    if (this.className === null) return null;
    const point = overCanvas ? { x, y } : null;
    this.reset();
    return point;
  }
}
