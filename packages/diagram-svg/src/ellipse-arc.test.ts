import { describe, expect, it } from "vitest";

import {
  ellipseArc,
  ellipseArcPathData,
  ellipseArcPoints,
} from "./ellipse-arc.js";
import { formatCoord } from "./smooth-path.js";

/** The unit circle, as the bounding rect both renderers hand in. */
const UNIT = { x: -1, y: -1, width: 2, height: 2 };

const QUARTER = { startAngle: 0, endAngle: 90 } as const;

/** Distance of a point from the unit circle. */
function radialError([x, y]: readonly [number, number]): number {
  return Math.abs(Math.hypot(x, y) - 1);
}

describe("ellipseArc", () => {
  it("resolves the spec defaults and derives the closure from the span", () => {
    expect(ellipseArc(UNIT, {})).toMatchObject({
      cx: 0,
      cy: 0,
      rx: 1,
      ry: 1,
      startAngle: 0,
      span: 360,
      closure: "Chord",
      full: true,
      filled: true,
    });
    expect(ellipseArc(UNIT, { endAngle: 90 }).closure).toBe("Radial");
  });

  it("prefers an annotated closure but ignores one it does not recognize", () => {
    expect(ellipseArc(UNIT, { ...QUARTER, closure: "None" })).toMatchObject({
      closure: "None",
      filled: false,
    });
    expect(ellipseArc(UNIT, { closure: "Bogus" }).closure).toBe("Chord");
  });

  it("keeps the span signed, and calls either direction past a turn full", () => {
    expect(ellipseArc(UNIT, { startAngle: 0, endAngle: -90 })).toMatchObject({
      span: -90,
      full: false,
    });
    expect(ellipseArc(UNIT, { startAngle: 0, endAngle: -360 }).full).toBe(true);
    expect(ellipseArc(UNIT, { startAngle: 90, endAngle: 450 }).full).toBe(true);
  });
});

describe("ellipseArcPathData", () => {
  const open = (fields: { startAngle: number; endAngle: number }): string =>
    ellipseArcPathData(ellipseArc(UNIT, { ...fields, closure: "None" }));

  it("takes its sweep direction from the sign of the span, not from the y-flip", () => {
    expect(open({ startAngle: 0, endAngle: 90 })).toBe("M 1 0 A 1 1 0 0 1 0 1");
    expect(open({ startAngle: 0, endAngle: -90 })).toBe(
      "M 1 0 A 1 1 0 0 0 0 -1",
    );
  });

  it("sets large-arc past a half turn", () => {
    expect(open({ startAngle: 0, endAngle: 180 })).toContain("A 1 1 0 0 1");
    expect(open({ startAngle: 0, endAngle: 181 })).toContain("A 1 1 0 1 1");
  });

  it("closes a Chord with Z and a Radial through the center", () => {
    const closure = (c: string): string =>
      ellipseArcPathData(ellipseArc(UNIT, { ...QUARTER, closure: c }));
    expect(closure("Chord")).toBe("M 1 0 A 1 1 0 0 1 0 1 Z");
    expect(closure("Radial")).toBe("M 0 0 L 1 0 A 1 1 0 0 1 0 1 Z");
    expect(closure("None").endsWith("Z")).toBe(false);
  });

  it("ends where the sampled outline ends, so the two producers cannot drift", () => {
    const arc = ellipseArc(
      { x: -25, y: -14, width: 60, height: 24 },
      { startAngle: 17, endAngle: 203, closure: "None" },
    );
    const last = ellipseArcPoints(arc).at(-1);
    if (last === undefined) {
      throw new Error("expected a sampled outline");
    }
    const [ex, ey] = last;
    expect(
      ellipseArcPathData(arc).endsWith(`${formatCoord(ex)} ${formatCoord(ey)}`),
    ).toBe(true);
  });
});

describe("ellipseArcPoints", () => {
  it("samples a full turn at the density the ring always used, then closes it", () => {
    const points = ellipseArcPoints(ellipseArc(UNIT, {}));
    expect(points).toHaveLength(65);
    expect(points[0]).toEqual([1, 0]);
    expect(points.at(-1)).toEqual(points[0]);
    expect(Math.max(...points.map(radialError))).toBeLessThan(1e-12);
  });

  it("closes a full turn even with the fill suppressed", () => {
    const points = ellipseArcPoints(ellipseArc(UNIT, { closure: "None" }));
    expect(points.at(-1)).toEqual(points[0]);
  });

  it("scales the sample count with the span", () => {
    const points = ellipseArcPoints(
      ellipseArc(UNIT, { ...QUARTER, closure: "None" }),
    );
    expect(points).toHaveLength(17);
    expect(Math.max(...points.map(radialError))).toBeLessThan(1e-12);
  });

  it.each([
    { closure: "None", length: 17, first: [1, 0], closed: false },
    { closure: "Chord", length: 18, first: [1, 0], closed: true },
    { closure: "Radial", length: 19, first: [0, 0], closed: true },
  ])(
    "anchors and closes a $closure slice",
    ({ closure, length, first, closed }) => {
      const points = ellipseArcPoints(
        ellipseArc(UNIT, { ...QUARTER, closure }),
      );
      expect(points).toHaveLength(length);
      expect(points[0]).toEqual(first);
      expect(points.at(-1)?.every((n, i) => n === first[i])).toBe(closed);
    },
  );

  it("collapses a zero span instead of emitting a doubled point", () => {
    const at = (closure: string): Array<[number, number]> =>
      ellipseArcPoints(
        ellipseArc(UNIT, { startAngle: 45, endAngle: 45, closure }),
      );
    expect(at("None")).toHaveLength(1);
    expect(at("Radial")).toEqual([[0, 0], at("None")[0]]);
  });
});
