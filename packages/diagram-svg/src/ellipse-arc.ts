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
 * `EllipseClosure.None` suppresses the fill as well as leaving the outline
 * open; `Chord` closes it with a straight chord and `Radial` through the
 * center.
 */

import {
  defaultEllipseClosure,
  ELLIPSE_DEFAULTS,
  type EllipseClosure,
} from "@dicode/omc-client/shapes";

import { formatCoord } from "./smooth-path.js";

/** An ellipse annotation's bounding box, center-and-radii form. */
export interface EllipseBox {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface EllipseArc extends EllipseBox {
  /** Degrees, counter-clockwise from `+x`. */
  startAngle: number;
  /** Signed sweep in degrees; negative sweeps clockwise. */
  span: number;
  closure: EllipseClosure;
  /** The sweep wraps the whole ellipse, which no single SVG `A` can express. */
  full: boolean;
}

/** Samples per whole turn, the resolution the full ring has always drawn at. */
const FULL_TURN_SEGMENTS = 64;

const CLOSURES: readonly EllipseClosure[] = ["None", "Chord", "Radial"];

/**
 * Resolves an ellipse annotation's arc fields against the spec defaults. An
 * unrecognized `closure` — the properties panel writes the field as free text —
 * resolves as an absent one does.
 */
export function ellipseArc(
  box: EllipseBox,
  shape: {
    startAngle?: number | undefined;
    endAngle?: number | undefined;
    closure?: string | undefined;
  },
): EllipseArc {
  const startAngle = shape.startAngle ?? ELLIPSE_DEFAULTS.startAngle;
  const endAngle = shape.endAngle ?? ELLIPSE_DEFAULTS.endAngle;
  const span = endAngle - startAngle;
  return {
    ...box,
    startAngle,
    span,
    closure:
      CLOSURES.find((c) => c === shape.closure) ?? defaultEllipseClosure(shape),
    full: Math.abs(span) >= 360,
  };
}

/**
 * SVG path `d` for the arc's painted outline. `arc.full` has no single-`A`
 * form — draw those as the bounding `<ellipse>` instead.
 */
export function ellipseArcPathData(arc: EllipseArc): string {
  const [sx, sy] = pointAt(arc, arc.startAngle);
  const [ex, ey] = pointAt(arc, arc.startAngle + arc.span);
  const largeArc = Math.abs(arc.span) > 180 ? 1 : 0;
  const sweep = arc.span > 0 ? 1 : 0;
  const sweepTo = `A ${formatCoord(arc.rx)} ${formatCoord(arc.ry)} 0 ${largeArc} ${sweep} ${formatCoord(ex)} ${formatCoord(ey)}`;
  const from = `M ${formatCoord(sx)} ${formatCoord(sy)}`;
  switch (arc.closure) {
    case "None":
      return `${from} ${sweepTo}`;
    case "Chord":
      return `${from} ${sweepTo} Z`;
    case "Radial":
      return `M ${formatCoord(arc.cx)} ${formatCoord(arc.cy)} L ${formatCoord(sx)} ${formatCoord(sy)} ${sweepTo} Z`;
  }
}

/**
 * The arc's painted outline as a polyline, at the same resolution per turn
 * whatever the sweep. `closed` says whether the outline joins back to its
 * first point; the ring itself never repeats that point.
 */
export function ellipseArcOutline(arc: EllipseArc): {
  points: Array<[number, number]>;
  closed: boolean;
} {
  const segments = Math.max(
    1,
    Math.ceil((FULL_TURN_SEGMENTS * Math.abs(arc.span)) / 360),
  );
  const points: Array<[number, number]> = [];
  const push = (p: [number, number]): void => {
    const prev = points.at(-1);
    if (prev && prev[0] === p[0] && prev[1] === p[1]) {
      return;
    }
    points.push(p);
  };
  if (arc.closure === "Radial" && !arc.full) {
    push([arc.cx, arc.cy]);
  }
  // A full sweep's final sample repeats its first; `closed` carries the join.
  const lastSample = arc.full ? segments - 1 : segments;
  for (let i = 0; i <= lastSample; i++) {
    push(pointAt(arc, arc.startAngle + (arc.span * i) / segments));
  }
  return { points, closed: arc.full || arc.closure !== "None" };
}

function pointAt(box: EllipseBox, degrees: number): [number, number] {
  const t = (degrees * Math.PI) / 180;
  return [box.cx + Math.cos(t) * box.rx, box.cy + Math.sin(t) * box.ry];
}
