/**
 * Geometry for Modelica's `Smooth.Bezier` on `Line` and `Polygon` (spec
 * §18.6.5), shared between the SVG renderer and the Pixi/GL renderer so the
 * two cannot draw the same annotation differently.
 *
 * The construction is OMEdit's (`LineAnnotation::getShape`,
 * `PolygonAnnotation::getShape`): the on-curve points are the *segment
 * midpoints*, and each source vertex becomes a control point pulling the
 * curve toward — but not through — itself, so a vertex is rounded rather
 * than interpolated.
 *
 * A `Polygon` differs from a `Line` in two places: it starts at the first
 * midpoint instead of at the first vertex, and it appends a wrap-around
 * cubic so the seam between the last and first vertex is rounded like every
 * other corner.
 *
 * The flattened form carries no zero-length segments: stroke builders derive
 * segment normals by differencing, and a repeated point yields no direction.
 */

/** A `[x, y]` pair in the shape's own coordinate space. */
type Pt = readonly [number, number];

type PathSegment =
  | { kind: "move"; to: Pt }
  | { kind: "line"; to: Pt }
  | { kind: "cubic"; c1: Pt; c2: Pt; to: Pt };

/** Flattening resolution: samples emitted per cubic. */
const SAMPLES_PER_CUBIC = 16;

/** Decimal places kept in emitted path data. */
const COORD_PRECISION = 4;

/** True when a shape's `smooth` field selects `Smooth.Bezier`. */
export function isBezierSmooth(smooth: string | undefined): boolean {
  return smooth === "Bezier";
}

/**
 * SVG path `d` for a `Smooth.Bezier` `Line` over `points`. Fewer than three
 * points cannot describe a curve and degrade to a straight segment.
 */
export function smoothLinePathData(points: readonly Pt[]): string {
  return segmentsToPathData(lineSegments(points));
}

/**
 * SVG path `d` for a `Smooth.Bezier` `Polygon` over `points`, closed with
 * `Z`. Accepts the ring either explicitly closed (last point repeating the
 * first, as most MSL annotations write it) or implicitly.
 */
export function smoothPolygonPathData(points: readonly Pt[]): string {
  const ring = closedRing(points);
  const d = segmentsToPathData(
    ring === null ? straightSegments(points) : polygonSegments(ring),
  );
  return d === "" ? "" : `${d} Z`;
}

/**
 * Flattened polyline approximating a `Smooth.Bezier` `Line`. The original
 * first and last points are preserved exactly, so arrowhead placement and
 * endpoint snapping stay put.
 */
export function smoothLinePoints(
  points: readonly Pt[],
): Array<[number, number]> {
  return flatten(lineSegments(points));
}

/**
 * Flattened ring approximating a `Smooth.Bezier` `Polygon`, closed by
 * repeating the first point last — the explicitly-closed convention the fill
 * and stroke builders already normalize. A ring with too few vertices to
 * curve passes through as given.
 */
export function smoothPolygonPoints(
  points: readonly Pt[],
): Array<[number, number]> {
  const ring = closedRing(points);
  if (ring === null) {
    return points.map(([x, y]) => [x, y]);
  }
  return flatten(polygonSegments(ring));
}

function midpoint(a: Pt, b: Pt): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Normalize to OMEdit's polygon shape — the vertex ring with the first
 * point repeated at the end. `null` when there are too few distinct
 * vertices to curve.
 */
function closedRing(points: readonly Pt[]): Pt[] | null {
  const open = points.map(([x, y]): Pt => [x, y]);
  const first = open[0];
  const last = open.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  if (open.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    open.pop();
  }
  if (open.length < 3) {
    return null;
  }
  open.push(first);
  return open;
}

function straightSegments(points: readonly Pt[]): PathSegment[] {
  const first = points[0];
  if (first === undefined) {
    return [];
  }
  const out: PathSegment[] = [{ kind: "move", to: first }];
  for (const p of points.slice(1)) {
    out.push({ kind: "line", to: p });
  }
  return out;
}

function lineSegments(points: readonly Pt[]): PathSegment[] {
  if (points.length < 3) {
    return straightSegments(points);
  }
  let p1 = points[0];
  let p2 = points[1];
  if (p1 === undefined || p2 === undefined) {
    return [];
  }
  const out: PathSegment[] = [{ kind: "move", to: p1 }];
  const lastIdx = points.length - 1;
  for (let i = 2; i <= lastIdx; i++) {
    const p3 = points[i];
    if (p3 === undefined) {
      break;
    }
    const m12 = midpoint(p1, p2);
    out.push({ kind: "line", to: m12 });
    out.push({ kind: "cubic", c1: m12, c2: p2, to: midpoint(p2, p3) });
    if (i === lastIdx) {
      out.push({ kind: "line", to: p3 });
    }
    p1 = p2;
    p2 = p3;
  }
  return out;
}

/** `ring` must come from `closedRing` — at least three vertices plus the repeat. */
function polygonSegments(ring: readonly Pt[]): PathSegment[] {
  let p1 = ring[0];
  let p2 = ring[1];
  if (p1 === undefined || p2 === undefined) {
    return [];
  }
  const wrap = p2;
  const out: PathSegment[] = [];
  const lastIdx = ring.length - 1;
  for (let i = 2; i <= lastIdx; i++) {
    const p3 = ring[i];
    if (p3 === undefined) {
      break;
    }
    const m12 = midpoint(p1, p2);
    const m23 = midpoint(p2, p3);
    if (i === 2) {
      out.push({ kind: "move", to: m12 });
    }
    out.push({ kind: "cubic", c1: m12, c2: p2, to: m23 });
    if (i === lastIdx) {
      out.push({ kind: "cubic", c1: m23, c2: p3, to: midpoint(p3, wrap) });
    }
    p1 = p2;
    p2 = p3;
  }
  return out;
}

function fmt(n: number): string {
  return String(Number(n.toFixed(COORD_PRECISION)));
}

function segmentsToPathData(segments: readonly PathSegment[]): string {
  return segments
    .map((seg) => {
      switch (seg.kind) {
        case "move":
          return `M ${fmt(seg.to[0])} ${fmt(seg.to[1])}`;
        case "line":
          return `L ${fmt(seg.to[0])} ${fmt(seg.to[1])}`;
        case "cubic":
          return `C ${fmt(seg.c1[0])} ${fmt(seg.c1[1])} ${fmt(seg.c2[0])} ${fmt(seg.c2[1])} ${fmt(seg.to[0])} ${fmt(seg.to[1])}`;
      }
    })
    .join(" ");
}

function cubicAt(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
  ];
}

function flatten(segments: readonly PathSegment[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const push = (p: Pt): void => {
    const prev = out.at(-1);
    if (prev && prev[0] === p[0] && prev[1] === p[1]) {
      return;
    }
    out.push([p[0], p[1]]);
  };
  let cursor: Pt | undefined;
  for (const seg of segments) {
    if (seg.kind === "cubic" && cursor !== undefined) {
      for (let k = 1; k <= SAMPLES_PER_CUBIC; k++) {
        push(cubicAt(cursor, seg.c1, seg.c2, seg.to, k / SAMPLES_PER_CUBIC));
      }
    } else {
      push(seg.to);
    }
    cursor = seg.to;
  }
  return out;
}
