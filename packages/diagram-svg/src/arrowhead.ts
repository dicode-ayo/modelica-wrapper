/**
 * Geometry for Modelica's `Line.arrow` and `arrowSize` (spec §18.6.5.5),
 * shared between the SVG renderer and the Pixi/GL renderer so the two cannot
 * draw the same annotation differently.
 *
 * A head caps one end of the annotated vertex list, pointing away from its
 * neighbouring vertex. Those are the vertices, not the drawn path, and that
 * holds under `Smooth.Bezier` too: the curve leaves `points[0]` toward
 * `points[1]` and enters the last vertex from the one before it, so the
 * control-point tangent is the drawn tangent.
 *
 * `Arrow.None`, an unrecognized kind, a non-positive size, and an endpoint its
 * neighbour coincides with all resolve to no head at all, so a renderer draws
 * what it is handed without re-deciding any of that.
 */

import { LINE_DEFAULTS } from "@dicode/omc-client/shapes";

import { formatCoord } from "./smooth-path.js";

/** §18.6.5.5 `Arrow` minus `None` — the values that draw something. */
const ARROW_KINDS = ["Filled", "Open", "Half"] as const;

export type ArrowKind = (typeof ARROW_KINDS)[number];

/** One resolved, drawable arrowhead. */
export interface Arrowhead {
  readonly kind: ArrowKind;
  /** Which end of the line it caps. */
  readonly end: "start" | "end";
  readonly tip: readonly [number, number];
  /** Unit vector from the shaft toward the tip. */
  readonly direction: readonly [number, number];
  /** Length along the shaft, in the line's own coordinate space. */
  readonly size: number;
}

/** A head's three corners: the tip, and the two base corners either side of it. */
export interface ArrowheadVertices {
  readonly tip: readonly [number, number];
  readonly left: readonly [number, number];
  readonly right: readonly [number, number];
}

/** Angle from the shaft centreline to each base corner. */
const HALF_ANGLE_RAD = 15 * (Math.PI / 180);

/**
 * The heads a line annotation draws, in `[start, end]` order, with the ends
 * that draw nothing left out.
 */
export function lineArrowheads(shape: {
  points: ReadonlyArray<readonly [number, number]>;
  arrow?: readonly [string, string] | undefined;
  arrowSize?: number | undefined;
}): Arrowhead[] {
  const [startKind, endKind] = shape.arrow ?? LINE_DEFAULTS.arrow;
  const size = shape.arrowSize ?? LINE_DEFAULTS.arrowSize;
  const last = shape.points.length - 1;
  return [
    resolveHead("start", startKind, shape.points[0], shape.points[1], size),
    resolveHead(
      "end",
      endKind,
      shape.points[last],
      shape.points[last - 1],
      size,
    ),
  ].filter((head) => head !== null);
}

/**
 * A head's corners. The base sits `size` back along the shaft with the corners
 * ±15° off the centreline; `left` is the counter-clockwise side.
 */
export function arrowheadVertices(head: Arrowhead): ArrowheadVertices {
  const [tipX, tipY] = head.tip;
  const [dirX, dirY] = head.direction;
  const halfWidth = head.size * Math.tan(HALF_ANGLE_RAD);
  const baseX = tipX - dirX * head.size;
  const baseY = tipY - dirY * head.size;
  const perpX = -dirY;
  const perpY = dirX;
  return {
    tip: [tipX, tipY],
    left: [baseX + perpX * halfWidth, baseY + perpY * halfWidth],
    right: [baseX - perpX * halfWidth, baseY - perpY * halfWidth],
  };
}

/**
 * SVG path `d` for a head's outline: `Filled` a closed triangle, `Open` a V
 * left open at the base, `Half` a single wing. §18.6.4 describes `Half` as
 * "half of a filled arrow" without saying which half, so it takes the
 * counter-clockwise one.
 */
export function arrowheadPathData(head: Arrowhead): string {
  const v = arrowheadVertices(head);
  switch (head.kind) {
    case "Filled":
      return `M ${formatPoint(v.tip)} L ${formatPoint(v.left)} L ${formatPoint(v.right)} Z`;
    case "Open":
      return `M ${formatPoint(v.left)} L ${formatPoint(v.tip)} L ${formatPoint(v.right)}`;
    case "Half":
      return `M ${formatPoint(v.tip)} L ${formatPoint(v.left)}`;
  }
}

function resolveHead(
  end: "start" | "end",
  kind: string,
  tip: readonly [number, number] | undefined,
  back: readonly [number, number] | undefined,
  size: number,
): Arrowhead | null {
  if (tip === undefined || back === undefined) return null;
  if (!isArrowKind(kind) || !(size > 0)) return null;
  const dx = tip[0] - back[0];
  const dy = tip[1] - back[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  return {
    kind,
    end,
    tip: [tip[0], tip[1]],
    direction: [dx / length, dy / length],
    size,
  };
}

function isArrowKind(value: string): value is ArrowKind {
  return ARROW_KINDS.some((kind) => kind === value);
}

function formatPoint([x, y]: readonly [number, number]): string {
  return `${formatCoord(x)} ${formatCoord(y)}`;
}
