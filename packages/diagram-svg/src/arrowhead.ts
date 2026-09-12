/**
 * Geometry for Modelica's `Line.arrow` and `arrowSize` (spec §18.6.5.5),
 * shared between the SVG renderer and the Pixi/GL renderer so the two cannot
 * draw the same annotation differently.
 *
 * A head caps one end of the annotated vertex list, pointing away from its
 * neighboring vertex. Those are the vertices, not the drawn path, and that
 * holds under `Smooth.Bezier` too: the curve leaves `points[0]` toward
 * `points[1]` and enters the last vertex from the one before it, so the
 * control-point tangent is the drawn tangent.
 *
 * `Arrow.None`, an unrecognized kind, a non-positive size, and an endpoint its
 * neighbor coincides with all resolve to no head at all, so a renderer draws
 * what it is handed without re-deciding any of that.
 *
 * The wing construction matches OMEdit's `LineAnnotation::drawArrow` (see
 * `arrowheadVertices` for the formula).
 */

import { LINE_DEFAULTS } from "@dicode/omc-client/shapes";

import { formatPoint } from "./smooth-path.js";

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
  /** Each wing's length, tip to base corner, in the line's own coordinate space. */
  readonly size: number;
}

/** A head's three corners: the tip, and the two base corners either side of it. */
export interface ArrowheadVertices {
  readonly tip: readonly [number, number];
  readonly left: readonly [number, number];
  readonly right: readonly [number, number];
}

/** A head's outline, in the order it is drawn. Never empty. */
export interface ArrowheadOutline {
  readonly vertices: readonly [
    readonly [number, number],
    ...(readonly [number, number])[],
  ];
  /** The outline closes back on its first corner and is filled, not stroked. */
  readonly closed: boolean;
}

/** Angle from the shaft centerline to each base corner. */
const HALF_ANGLE_RAD = 30 * (Math.PI / 180);

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
 * A head's corners. Each wing is `size` long, ±30° off the centerline, so the
 * base sits `size·cos(30°)` back along the shaft with the corners
 * `size·sin(30°)` off it; `left` is the counter-clockwise side.
 */
export function arrowheadVertices(head: Arrowhead): ArrowheadVertices {
  const [tipX, tipY] = head.tip;
  const [dirX, dirY] = head.direction;
  const halfWidth = head.size * Math.sin(HALF_ANGLE_RAD);
  const baseOffset = head.size * Math.cos(HALF_ANGLE_RAD);
  const baseX = tipX - dirX * baseOffset;
  const baseY = tipY - dirY * baseOffset;
  const perpX = -dirY;
  const perpY = dirX;
  return {
    tip: [tipX, tipY],
    left: [baseX + perpX * halfWidth, baseY + perpY * halfWidth],
    right: [baseX - perpX * halfWidth, baseY - perpY * halfWidth],
  };
}

/**
 * The corners a head's outline visits, and whether it closes back on the
 * first: `Filled` a closed triangle, `Open` a V left open at the base, `Half`
 * a single wing. The spec does not say which wing `Half` keeps; OMEdit's
 * `LineAnnotation::drawArrow` zeroes the clockwise one, so the
 * counter-clockwise wing is the one it draws.
 */
export function arrowheadOutline(head: Arrowhead): ArrowheadOutline {
  const { tip, left, right } = arrowheadVertices(head);
  switch (head.kind) {
    case "Filled":
      return { vertices: [tip, left, right], closed: true };
    case "Open":
      return { vertices: [left, tip, right], closed: false };
    case "Half":
      return { vertices: [tip, left], closed: false };
  }
}

/** SVG path `d` for a head's outline. */
export function arrowheadPathData(head: Arrowhead): string {
  const { vertices, closed } = arrowheadOutline(head);
  const d = vertices
    .map((corner, i) => `${i === 0 ? "M" : "L"} ${formatPoint(corner)}`)
    .join(" ");
  return closed ? `${d} Z` : d;
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
