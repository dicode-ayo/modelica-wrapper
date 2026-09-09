/**
 * Geometry for Modelica's `Ellipse.startAngle` / `endAngle` / `closure`
 * (spec §18.6.5.5), shared between the SVG renderer and the Pixi/GL renderer
 * so the two cannot draw the same annotation differently.
 *
 * The construction is OMEdit's (`EllipseAnnotation::drawAnnotation`): angles
 * are degrees counter-clockwise from `+x`, and the sweep is the *signed*
 * `endAngle - startAngle`, so a descending pair sweeps clockwise rather than
 * the long way round. Both renderers place their coordinates in Modelica's
 * y-up frame — the SVG one inside the root `scale(1,-1)` — which is the frame
 * those angles are measured in, so neither needs a direction correction.
 *
 * `EllipseClosure.None` leaves the outline open *and* suppresses the fill;
 * `Chord` closes it with a straight chord and `Radial` through the center.
 * Those two rules disagree for a full sweep, which closes whatever its
 * closure says, so `full` and `filled` are stated separately.
 */

import {
  defaultEllipseClosure,
  ELLIPSE_DEFAULTS,
  isEllipseClosure,
  type EllipseClosure,
} from "@dicode/omc-client/shapes";

import { formatCoord } from "./smooth-path.js";

export interface EllipseArc {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** Degrees, counter-clockwise from `+x`. */
  readonly startAngle: number;
  /** Sweep in degrees, clamped to one turn; negative sweeps clockwise. */
  readonly span: number;
  readonly closure: EllipseClosure;
  /** The sweep covers the whole ellipse, whatever the closure. */
  readonly full: boolean;
  /** The interior is painted; `EllipseClosure.None` suppresses it. */
  readonly filled: boolean;
}

/** Samples per whole turn. */
const FULL_TURN_SEGMENTS = 64;

const FULL_TURN_DEGREES = 360;

/**
 * Resolves an ellipse annotation's arc fields against the spec defaults, over
 * the ellipse's bounding box. A sweep past a whole turn clamps to one, so it
 * cannot retrace itself. An unrecognized `closure` resolves as an absent one
 * does.
 */
export function ellipseArc(
  rect: { x: number; y: number; width: number; height: number },
  shape: {
    startAngle?: number | undefined;
    endAngle?: number | undefined;
    closure?: string | undefined;
  },
): EllipseArc {
  const startAngle = shape.startAngle ?? ELLIPSE_DEFAULTS.startAngle;
  const endAngle = shape.endAngle ?? ELLIPSE_DEFAULTS.endAngle;
  const span = Math.max(
    -FULL_TURN_DEGREES,
    Math.min(FULL_TURN_DEGREES, endAngle - startAngle),
  );
  const closure = isEllipseClosure(shape.closure)
    ? shape.closure
    : defaultEllipseClosure({ startAngle, endAngle });
  return {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
    rx: rect.width / 2,
    ry: rect.height / 2,
    startAngle,
    span,
    closure,
    full: Math.abs(span) === FULL_TURN_DEGREES,
    filled: closure !== "None",
  };
}

/** SVG path `d` for the arc's painted outline. */
export function ellipseArcPathData(arc: EllipseArc): string {
  const start = formatPoint(pointAt(arc, arc.startAngle));
  const radii = `${formatCoord(arc.rx)} ${formatCoord(arc.ry)} 0`;
  const sweep = arc.span > 0 ? 1 : 0;
  if (arc.full) {
    // One `A` whose endpoints coincide is dropped by the SVG spec, so a whole
    // turn has to be two half turns.
    const mid = formatPoint(pointAt(arc, arc.startAngle + arc.span / 2));
    return `M ${start} A ${radii} 1 ${sweep} ${mid} A ${radii} 1 ${sweep} ${start} Z`;
  }
  const end = formatPoint(pointAt(arc, arc.startAngle + arc.span));
  const largeArc = Math.abs(arc.span) > 180 ? 1 : 0;
  const sweepTo = `A ${radii} ${largeArc} ${sweep} ${end}`;
  switch (arc.closure) {
    case "None":
      return `M ${start} ${sweepTo}`;
    case "Chord":
      return `M ${start} ${sweepTo} Z`;
    case "Radial":
      return `M ${formatPoint([arc.cx, arc.cy])} L ${start} ${sweepTo} Z`;
  }
}

/**
 * The arc's painted outline as a polyline, at the same resolution per turn
 * whatever the sweep. Closed, with the first point repeated last as
 * `buildStroke` takes it and `stripClosingDuplicate` undoes it, when
 * `arc.full` or `arc.filled`; open otherwise. A `Radial` slice starts at the
 * center.
 */
export function ellipseArcPoints(arc: EllipseArc): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  if (arc.closure === "Radial" && !arc.full) {
    points.push([arc.cx, arc.cy]);
  }
  // A zero sweep has one distinct sample, so it never closes into a ring.
  if (arc.span === 0) {
    points.push(pointAt(arc, arc.startAngle));
    return points;
  }
  const segments = Math.ceil(
    (FULL_TURN_SEGMENTS * Math.abs(arc.span)) / FULL_TURN_DEGREES,
  );
  // A full sweep's last sample repeats its first; the closing repeat covers it.
  const lastSample = arc.full ? segments - 1 : segments;
  for (let i = 0; i <= lastSample; i++) {
    points.push(pointAt(arc, arc.startAngle + (arc.span * i) / segments));
  }
  const first = points[0];
  if ((arc.full || arc.filled) && first !== undefined) {
    points.push([first[0], first[1]]);
  }
  return points;
}

function pointAt(arc: EllipseArc, degrees: number): [number, number] {
  const t = (degrees * Math.PI) / 180;
  return [arc.cx + Math.cos(t) * arc.rx, arc.cy + Math.sin(t) * arc.ry];
}

function formatPoint([x, y]: readonly [number, number]): string {
  return `${formatCoord(x)} ${formatCoord(y)}`;
}
