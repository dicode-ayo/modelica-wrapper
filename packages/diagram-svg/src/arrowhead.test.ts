import { describe, expect, it } from "vitest";

import {
  arrowheadPathData,
  arrowheadVertices,
  lineArrowheads,
  type Arrowhead,
} from "./arrowhead.js";
import { smoothLinePoints } from "./smooth-path.js";

const HALF_ANGLE_RAD = 15 * (Math.PI / 180);

/** A rightward head at the origin, the shape every geometry case starts from. */
const RIGHTWARD: Arrowhead = {
  kind: "Filled",
  end: "end",
  tip: [0, 0],
  direction: [1, 0],
  size: 4,
};

describe("lineArrowheads", () => {
  it("resolves both ends against the spec defaults", () => {
    expect(
      lineArrowheads({
        points: [
          [0, 0],
          [10, 0],
        ],
        arrow: ["Open", "Filled"],
      }),
    ).toEqual([
      { kind: "Open", end: "start", tip: [0, 0], direction: [-1, 0], size: 3 },
      { kind: "Filled", end: "end", tip: [10, 0], direction: [1, 0], size: 3 },
    ]);
  });

  it("draws nothing for an absent, None, or unrecognized arrow", () => {
    const points = [
      [0, 0],
      [10, 0],
    ] as const;
    expect(lineArrowheads({ points })).toEqual([]);
    expect(lineArrowheads({ points, arrow: ["None", "None"] })).toEqual([]);
    expect(lineArrowheads({ points, arrow: ["Bogus", "none"] })).toEqual([]);
  });

  it("honors arrowSize and drops a non-positive one", () => {
    const points = [
      [0, 0],
      [10, 0],
    ] as const;
    const arrow = ["Filled", "Filled"] as const;
    expect(lineArrowheads({ points, arrow, arrowSize: 12 })[0]?.size).toBe(12);
    expect(lineArrowheads({ points, arrow, arrowSize: 0 })).toEqual([]);
    expect(lineArrowheads({ points, arrow, arrowSize: -3 })).toEqual([]);
  });

  it("drops an end with no neighbor to take a direction from", () => {
    const arrow = ["Filled", "Filled"] as const;
    expect(lineArrowheads({ points: [], arrow })).toEqual([]);
    expect(lineArrowheads({ points: [[0, 0]], arrow })).toEqual([]);
    expect(
      lineArrowheads({
        points: [
          [5, 5],
          [5, 5],
        ],
        arrow,
      }),
    ).toEqual([]);
  });

  it("points a head along the tangent the Bezier curve actually leaves by", () => {
    const points = [
      [0, 0],
      [10, 10],
      [20, 0],
    ] as const;
    const [start, end] = lineArrowheads({
      points,
      arrow: ["Filled", "Filled"],
    });
    const curve = smoothLinePoints(points);
    // The flattened curve's own first and last steps, which the control-point
    // tangent has to agree with for a curve to cap where it is drawn.
    expectDirection(start?.direction, unitStep(curve[1], curve[0]));
    expectDirection(end?.direction, unitStep(curve.at(-2), curve.at(-1)));
  });
});

describe("arrowheadVertices", () => {
  it("keeps the tip on the endpoint and the base corners symmetric about the shaft", () => {
    const v = arrowheadVertices({ ...RIGHTWARD, tip: [10, 20] });
    const halfWidth = 4 * Math.tan(HALF_ANGLE_RAD);
    expect(v.tip).toEqual([10, 20]);
    expect(v.left[0]).toBeCloseTo(6);
    expect(v.left[1]).toBeCloseTo(20 + halfWidth);
    expect(v.right[0]).toBeCloseTo(6);
    expect(v.right[1]).toBeCloseTo(20 - halfWidth);
  });

  it("puts `left` on the counter-clockwise side", () => {
    const v = arrowheadVertices({ ...RIGHTWARD, direction: [0, 1] });
    expect(v.left[0]).toBeLessThan(v.right[0]);
  });

  it("opens each corner 15° off the shaft, whatever the direction", () => {
    const diagonal = Math.SQRT1_2;
    for (const head of [
      RIGHTWARD,
      { ...RIGHTWARD, direction: [diagonal, diagonal] as const },
    ]) {
      const v = arrowheadVertices(head);
      for (const corner of [v.left, v.right]) {
        expect(cornerAngle(v.tip, corner, head.direction)).toBeCloseTo(
          HALF_ANGLE_RAD,
          10,
        );
      }
    }
  });
});

describe("arrowheadPathData", () => {
  it("closes a Filled head and leaves an Open one open at the base", () => {
    const filled = arrowheadPathData(RIGHTWARD);
    expect(filled).toBe("M 0 0 L -4 1.0718 L -4 -1.0718 Z");
    expect(arrowheadPathData({ ...RIGHTWARD, kind: "Open" })).toBe(
      "M -4 1.0718 L 0 0 L -4 -1.0718",
    );
  });

  it("draws a Half head as the counter-clockwise wing alone", () => {
    expect(arrowheadPathData({ ...RIGHTWARD, kind: "Half" })).toBe(
      "M 0 0 L -4 1.0718",
    );
  });
});

/** Unit vector from `back` to `tip`. */
function unitStep(
  back: readonly [number, number] | undefined,
  tip: readonly [number, number] | undefined,
): [number, number] {
  if (back === undefined || tip === undefined) {
    throw new Error("expected both points");
  }
  const dx = tip[0] - back[0];
  const dy = tip[1] - back[1];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length];
}

function expectDirection(
  actual: readonly [number, number] | undefined,
  expected: readonly [number, number],
): void {
  expect(actual?.[0]).toBeCloseTo(expected[0], 10);
  expect(actual?.[1]).toBeCloseTo(expected[1], 10);
}

/** Angle at the tip between the shaft's back-direction and one base corner. */
function cornerAngle(
  tip: readonly [number, number],
  corner: readonly [number, number],
  direction: readonly [number, number],
): number {
  const dx = corner[0] - tip[0];
  const dy = corner[1] - tip[1];
  const cos = (dx * -direction[0] + dy * -direction[1]) / Math.hypot(dx, dy);
  return Math.acos(Math.min(1, cos));
}
