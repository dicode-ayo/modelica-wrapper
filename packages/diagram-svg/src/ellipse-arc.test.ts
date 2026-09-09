import { describe, expect, it } from "vitest";

import {
  ellipseArc,
  ellipseArcOutline,
  ellipseArcPathData,
  type EllipseBox,
} from "./ellipse-arc.js";
import { formatCoord } from "./smooth-path.js";

const UNIT: EllipseBox = { cx: 0, cy: 0, rx: 1, ry: 1 };

/** Distance of a point from the unit circle. */
function radialError([x, y]: readonly [number, number]): number {
  return Math.abs(Math.hypot(x, y) - 1);
}

describe("ellipseArc", () => {
  it("resolves the spec defaults to a full Chord ellipse", () => {
    const arc = ellipseArc(UNIT, {});
    expect(arc.startAngle).toBe(0);
    expect(arc.span).toBe(360);
    expect(arc.closure).toBe("Chord");
    expect(arc.full).toBe(true);
  });

  it("derives Radial for a partial span and Chord for a full one", () => {
    expect(ellipseArc(UNIT, { endAngle: 90 }).closure).toBe("Radial");
    expect(ellipseArc(UNIT, { startAngle: 0, endAngle: 360 }).closure).toBe(
      "Chord",
    );
  });

  it("keeps the span signed so a descending sweep stays clockwise", () => {
    const arc = ellipseArc(UNIT, { startAngle: 0, endAngle: -90 });
    expect(arc.span).toBe(-90);
    expect(arc.full).toBe(false);
  });

  it("treats either sweep direction past a whole turn as full", () => {
    expect(ellipseArc(UNIT, { startAngle: 0, endAngle: -360 }).full).toBe(true);
    expect(ellipseArc(UNIT, { startAngle: 90, endAngle: 450 }).full).toBe(true);
  });

  it("falls back to the derived closure when the annotated one is unknown", () => {
    expect(ellipseArc(UNIT, { closure: "Bogus" }).closure).toBe("Chord");
    expect(ellipseArc(UNIT, { endAngle: 90, closure: "None" }).closure).toBe(
      "None",
    );
  });
});

describe("ellipseArcPathData", () => {
  it("takes its sweep direction from the sign of the span, not from the y-flip", () => {
    const up = ellipseArc(UNIT, {
      startAngle: 0,
      endAngle: 90,
      closure: "None",
    });
    const down = ellipseArc(UNIT, {
      startAngle: 0,
      endAngle: -90,
      closure: "None",
    });
    expect(ellipseArcPathData(up)).toBe("M 1 0 A 1 1 0 0 1 0 1");
    expect(ellipseArcPathData(down)).toBe("M 1 0 A 1 1 0 0 0 0 -1");
  });

  it("sets large-arc past a half turn", () => {
    const short = ellipseArcPathData(
      ellipseArc(UNIT, { startAngle: 0, endAngle: 180, closure: "None" }),
    );
    const long = ellipseArcPathData(
      ellipseArc(UNIT, { startAngle: 0, endAngle: 181, closure: "None" }),
    );
    expect(short).toContain("A 1 1 0 0 1");
    expect(long).toContain("A 1 1 0 1 1");
  });

  it("closes a Chord with Z and a Radial through the center", () => {
    const chord = ellipseArcPathData(
      ellipseArc(UNIT, { startAngle: 0, endAngle: 90, closure: "Chord" }),
    );
    const radial = ellipseArcPathData(
      ellipseArc(UNIT, { startAngle: 0, endAngle: 90, closure: "Radial" }),
    );
    const open = ellipseArcPathData(
      ellipseArc(UNIT, { startAngle: 0, endAngle: 90, closure: "None" }),
    );
    expect(chord).toBe("M 1 0 A 1 1 0 0 1 0 1 Z");
    expect(radial).toBe("M 0 0 L 1 0 A 1 1 0 0 1 0 1 Z");
    expect(open.endsWith("Z")).toBe(false);
  });

  it("ends where the sampled outline ends, so the two producers cannot drift", () => {
    const arc = ellipseArc(
      { cx: 5, cy: -2, rx: 30, ry: 12 },
      { startAngle: 17, endAngle: 203, closure: "None" },
    );
    const last = ellipseArcOutline(arc).points.at(-1);
    if (last === undefined) {
      throw new Error("expected a sampled outline");
    }
    const [ex, ey] = last;
    expect(
      ellipseArcPathData(arc).endsWith(`${formatCoord(ex)} ${formatCoord(ey)}`),
    ).toBe(true);
  });
});

describe("ellipseArcOutline", () => {
  it("samples a full turn at the density the ring always used", () => {
    const { points, closed } = ellipseArcOutline(ellipseArc(UNIT, {}));
    expect(points).toHaveLength(64);
    expect(points[0]).toEqual([1, 0]);
    expect(closed).toBe(true);
    expect(Math.max(...points.map(radialError))).toBeLessThan(1e-12);
  });

  it("scales the sample count with the span", () => {
    const quarter = ellipseArcOutline(
      ellipseArc(UNIT, { startAngle: 0, endAngle: 90, closure: "None" }),
    );
    expect(quarter.points).toHaveLength(17);
    expect(Math.max(...quarter.points.map(radialError))).toBeLessThan(1e-12);
  });

  it("leaves an open arc open and closes the other two", () => {
    const partial = { startAngle: 0, endAngle: 90 };
    expect(
      ellipseArcOutline(ellipseArc(UNIT, { ...partial, closure: "None" }))
        .closed,
    ).toBe(false);
    expect(
      ellipseArcOutline(ellipseArc(UNIT, { ...partial, closure: "Chord" }))
        .closed,
    ).toBe(true);
    expect(
      ellipseArcOutline(ellipseArc(UNIT, { ...partial, closure: "Radial" }))
        .closed,
    ).toBe(true);
  });

  it("closes a full turn even with the fill suppressed", () => {
    expect(
      ellipseArcOutline(ellipseArc(UNIT, { closure: "None" })).closed,
    ).toBe(true);
  });

  it("anchors a Radial slice at the center and a Chord only on the arc", () => {
    const partial = { startAngle: 0, endAngle: 90 };
    const radial = ellipseArcOutline(
      ellipseArc(UNIT, { ...partial, closure: "Radial" }),
    );
    const chord = ellipseArcOutline(
      ellipseArc(UNIT, { ...partial, closure: "Chord" }),
    );
    expect(radial.points[0]).toEqual([0, 0]);
    expect(radial.points).toHaveLength(chord.points.length + 1);
    expect(chord.points[0]).toEqual([1, 0]);
  });

  it("keeps a full ring free of the closing duplicate", () => {
    const { points } = ellipseArcOutline(ellipseArc(UNIT, {}));
    const first = points[0];
    const last = points.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(last).not.toEqual(first);
  });

  it("collapses a zero span instead of emitting a doubled point", () => {
    const { points } = ellipseArcOutline(
      ellipseArc(UNIT, { startAngle: 45, endAngle: 45, closure: "None" }),
    );
    expect(points).toHaveLength(1);
  });
});
