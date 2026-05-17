/**
 * Snap-to-grid math for diagram interactions.
 *
 * Modelica's `Diagram.coordinateSystem.grid={dx,dy}` annotation (spec
 * §18, mirrored by OMEdit's preferences) declares the snap step in
 * diagram units. We read it from the layout, fall back to OMEdit's
 * historic default `[2, 2]` when absent, and allow an explicit
 * override (UI-bound later) to short-circuit either path.
 *
 * Conventions:
 *   - Resolved grid `[0, 0]` means snapping is disabled — pass-through.
 *   - Non-finite or negative components disable that axis.
 *   - Both move (`snapDelta`) and add (`snapPoint`) round to the
 *     nearest grid step, matching OMEdit's "Snap to Grid" behaviour.
 */

import type {
  CoordinateSystem,
  Extent,
  Placement,
} from "@modelica-wrapper/omc-client";

/** Per-axis snap step in diagram units; `[0, 0]` disables snapping. */
export type SnapGrid = readonly [number, number];

/**
 * Modelica spec §18 / OMEdit default when `coordinateSystem.grid` is
 * omitted from the source annotation. Two diagram units in both axes.
 */
export const DEFAULT_SNAP_GRID: SnapGrid = [2, 2];

/** Snap disabled — sentinel for "no grid step on either axis". */
export const NO_SNAP: SnapGrid = [0, 0];

/**
 * Resolve the active snap grid from (in priority order) an explicit
 * override, the layout's `coordinateSystem.grid`, then the OMEdit
 * default. The override exists so a UI control (settings panel,
 * keyboard toggle) can sit on top of the annotation-driven value.
 *
 *   - `override = undefined` → defer to `coordinateSystem.grid` or default.
 *   - `override = [0, 0]`    → caller explicitly disabled snapping.
 *   - `override = [x, y]`    → use those values.
 */
export function resolveSnapGrid(
  coordinateSystem: CoordinateSystem | undefined,
  override?: SnapGrid | undefined,
): SnapGrid {
  if (override !== undefined) {
    return sanitise(override);
  }
  const fromAnnotation = coordinateSystem?.grid;
  if (
    Array.isArray(fromAnnotation) &&
    fromAnnotation.length >= 2 &&
    typeof fromAnnotation[0] === "number" &&
    typeof fromAnnotation[1] === "number"
  ) {
    return sanitise([fromAnnotation[0], fromAnnotation[1]]);
  }
  return DEFAULT_SNAP_GRID;
}

/**
 * Snap a (dx, dy) drag delta to whole multiples of the grid. Used by
 * the move handler so components keep their grid alignment as the
 * user drags. If both axes are disabled, returns the input verbatim
 * (no allocation surprise for the hot path).
 */
export function snapDelta(
  dx: number,
  dy: number,
  grid: SnapGrid,
): { dx: number; dy: number } {
  return { dx: snapScalar(dx, grid[0]), dy: snapScalar(dy, grid[1]) };
}

/**
 * Snap an absolute (x, y) point to the nearest grid intersection.
 * Used by the add handler to align newly-placed components to the
 * grid even when the user double-clicked off-grid.
 */
export function snapPoint(
  x: number,
  y: number,
  grid: SnapGrid,
): { x: number; y: number } {
  return { x: snapScalar(x, grid[0]), y: snapScalar(y, grid[1]) };
}

/**
 * Snap both corners of a Modelica `Extent` independently so the
 * committed bounding box always lands on grid intersections. Critical
 * for "snap on commit": `snapDelta` preserves a component's
 * off-grid offset (if it started at extent `{{3,7},{23,27}}`, all
 * subsequent moves stay 1 unit off the {2,2} grid). Running each
 * corner through this helper after the move pulls the value back
 * onto the grid.
 */
export function snapExtent(extent: Extent, grid: SnapGrid): Extent {
  const [a, b] = extent;
  return [
    [snapScalar(a[0], grid[0]), snapScalar(a[1], grid[1])],
    [snapScalar(b[0], grid[0]), snapScalar(b[1], grid[1])],
  ];
}

/**
 * Snap an entire `Placement`: both extent corners + the (optional)
 * origin offset. Returns the same reference if nothing changed so
 * downstream change-detection (Lit's `.layout`, diffLayouts) stays
 * cheap on idempotent calls.
 */
export function snapPlacement(
  placement: Placement,
  grid: SnapGrid,
): Placement {
  const extent = snapExtent(placement.extent, grid);
  const origin = placement.origin
    ? ([
        snapScalar(placement.origin[0], grid[0]),
        snapScalar(placement.origin[1], grid[1]),
      ] as const)
    : undefined;
  const extentUnchanged =
    extent[0][0] === placement.extent[0][0] &&
    extent[0][1] === placement.extent[0][1] &&
    extent[1][0] === placement.extent[1][0] &&
    extent[1][1] === placement.extent[1][1];
  const originUnchanged =
    !origin ||
    !placement.origin ||
    (origin[0] === placement.origin[0] && origin[1] === placement.origin[1]);
  if (extentUnchanged && originUnchanged) {
    return placement;
  }
  if (origin) {
    return { ...placement, extent, origin: [origin[0], origin[1]] };
  }
  return { ...placement, extent };
}

/**
 * Round `value` to the nearest multiple of `step`. `step <= 0` (the
 * "disabled" sentinel) returns `value` unchanged.
 */
function snapScalar(value: number, step: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Replace non-finite or negative entries with `0` so they disable
 * their axis rather than poisoning later math with `NaN`.
 */
function sanitise(grid: SnapGrid): SnapGrid {
  return [
    Number.isFinite(grid[0]) && grid[0] >= 0 ? grid[0] : 0,
    Number.isFinite(grid[1]) && grid[1] >= 0 ? grid[1] : 0,
  ];
}
