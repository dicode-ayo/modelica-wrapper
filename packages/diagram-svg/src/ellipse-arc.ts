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
 * closure says, so `closed` and `filled` are stated separately.
 */

import {
  defaultEllipseClosure,
  isEllipseClosure,
  ELLIPSE_DEFAULTS,
  type EllipseClosure,
} from "@dicode/omc-client/shapes";

import { formatCoord } from "./smooth-path.js";

export interface EllipseArc {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Degrees, counter-clockwise from `+x`. */
  startAngle: number;
  /** Signed sweep in degrees; negative sweeps clockwise. */
  span: number;
  closure: EllipseClosure;
  /** The sweep wraps the whole ellipse, which no single SVG `A` can express. */
  full: boolean;
  /** The interior is painted. */
  filled: boolean;
}

/** Samples per whole turn, the resolution the full ring has always drawn at. */
const FULL_TURN_SEGMENTS = 64;

/**
 * Resolves an ellipse annotation's arc fields against the spec defaults, over
 * the bounding box `extentToRect` already produced. An unrecognized `closure`
 * resolves as an absent one does.
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
  const span = endAngle - startAngle;
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
    full: Math.abs(span) >= 360,
    filled: closure !== "None",
  };
}

/**
 * SVG path `d` for the arc's painted outline. `arc.full` has no single-`A`
 * form — draw those as the bounding `<ellipse>` instead.
 */
export function ellipseArcPathData(arc: EllipseArc): string {
  const start = formatPoint(pointAt(arc, arc.startAngle));
  const end = formatPoint(pointAt(arc, arc.startAngle + arc.span));
  const largeArc = Math.abs(arc.span) > 180 ? 1 : 0;
  const sweep = arc.span > 0 ? 1 : 0;
  const sweepTo = `A ${formatCoord(arc.rx)} ${formatCoord(arc.ry)} 0 ${largeArc} ${sweep} ${end}`;
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
 * whatever the sweep. A closed outline repeats its first point last, the
 * convention the stroke builder takes and `stripClosingDuplicate` undoes.
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
  const segments = Math.ceil((FULL_TURN_SEGMENTS * Math.abs(arc.span)) / 360);
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
