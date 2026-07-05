import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";

import {
  DEFAULT_ARROW_SIZE,
  arrowheadVertices,
  buildArrowhead,
} from "../src/primitives/arrow-utils.js";

// ─── Pure geometry ──────────────────────────────────────────────────────────

const HALF_ANGLE_RAD = 15 * (Math.PI / 180);
const TAN_HA = Math.tan(HALF_ANGLE_RAD);

describe("arrowheadVertices", () => {
  it("places the tip exactly at the given endpoint", () => {
    const v = arrowheadVertices([10, 20], 1, 0, 5);
    expect(v.tip).toEqual([10, 20]);
  });

  it("places base corners symmetrically for a rightward arrow", () => {
    const size = 4;
    const v = arrowheadVertices([10, 0], 1, 0, size);
    const hw = size * TAN_HA;
    // base centre is at (10-4, 0) = (6, 0); perp for +X is (0,1)
    expect(v.left[0]).toBeCloseTo(6);
    expect(v.left[1]).toBeCloseTo(hw);
    expect(v.right[0]).toBeCloseTo(6);
    expect(v.right[1]).toBeCloseTo(-hw);
  });

  it("places base corners symmetrically for an upward arrow", () => {
    const size = 3;
    const v = arrowheadVertices([0, 10], 0, 1, size);
    const hw = size * TAN_HA;
    // base centre is at (0, 7); perp for +Y is (-1, 0)
    expect(v.left[0]).toBeCloseTo(-hw);
    expect(v.left[1]).toBeCloseTo(7);
    expect(v.right[0]).toBeCloseTo(hw);
    expect(v.right[1]).toBeCloseTo(7);
  });

  it("left and right are equidistant from the base centreline", () => {
    const v = arrowheadVertices([5, 5], 0.6, 0.8, 10);
    const bx = 5 - 0.6 * 10;
    const by = 5 - 0.8 * 10;
    const dLeft = Math.hypot(v.left[0] - bx, v.left[1] - by);
    const dRight = Math.hypot(v.right[0] - bx, v.right[1] - by);
    expect(dLeft).toBeCloseTo(dRight, 10);
  });

  it("half-angle from shaft to each corner is 15°", () => {
    const v = arrowheadVertices([10, 0], 1, 0, 4);
    const tx = v.left[0] - v.tip[0];
    const ty = v.left[1] - v.tip[1];
    // Back-direction (opposite of rightward) = (-1, 0)
    const cos = (tx * -1 + ty * 0) / Math.hypot(tx, ty);
    expect(Math.acos(Math.min(1, cos))).toBeCloseTo(HALF_ANGLE_RAD, 10);
  });

  it("tip is at the correct arrowhead length from each base corner", () => {
    const size = 5;
    const v = arrowheadVertices([0, 0], 1, 0, size);
    const hw = size * TAN_HA;
    const expected = Math.sqrt(size * size + hw * hw);
    expect(Math.hypot(v.tip[0] - v.left[0], v.tip[1] - v.left[1])).toBeCloseTo(
      expected,
    );
    expect(
      Math.hypot(v.tip[0] - v.right[0], v.tip[1] - v.right[1]),
    ).toBeCloseTo(expected);
  });

  it("works for a diagonal direction", () => {
    const d = Math.SQRT1_2;
    const v = arrowheadVertices([0, 0], d, d, 4);
    const bx = 0 - d * 4;
    const by = 0 - d * 4;
    const dLeft = Math.hypot(v.left[0] - bx, v.left[1] - by);
    const dRight = Math.hypot(v.right[0] - bx, v.right[1] - by);
    expect(dLeft).toBeCloseTo(dRight, 10);
    const tx = v.left[0] - v.tip[0];
    const ty = v.left[1] - v.tip[1];
    const backX = -d;
    const backY = -d;
    const cos = (tx * backX + ty * backY) / Math.hypot(tx, ty);
    expect(Math.acos(Math.min(1, cos))).toBeCloseTo(HALF_ANGLE_RAD, 10);
  });
});

// ─── Pixi Graphics building ─────────────────────────────────────────────────

const BLACK: Color = [0, 0, 0];
const TIP: [number, number] = [10, 0];

/** Read the style of a Graphics' first fill/stroke instruction. */
interface DrawStyle {
  color: number;
  width?: number;
}
function styleOf(g: Graphics, action: "fill" | "stroke"): DrawStyle | null {
  const ins = (
    g.context.instructions as ReadonlyArray<{
      action: string;
      data: { style: DrawStyle };
    }>
  ).find((i) => i.action === action);
  return ins?.data.style ?? null;
}

function makeParent(): Container {
  return new Container({ label: "parent" });
}

describe("buildArrowhead", () => {
  it("returns null for Arrow.None", () => {
    expect(
      buildArrowhead(makeParent(), TIP, 1, 0, 3, "None", BLACK, 0, "t", 1),
    ).toBeNull();
  });

  it("returns null for an empty kind string", () => {
    expect(
      buildArrowhead(makeParent(), TIP, 1, 0, 3, "", BLACK, 0, "t", 1),
    ).toBeNull();
  });

  it("returns null for a zero-length direction vector", () => {
    expect(
      buildArrowhead(makeParent(), TIP, 0, 0, 3, "Filled", BLACK, 0, "t", 1),
    ).toBeNull();
  });

  it("returns null for a non-positive size", () => {
    expect(
      buildArrowhead(makeParent(), TIP, 1, 0, 0, "Filled", BLACK, 0, "t", 1),
    ).toBeNull();
    expect(
      buildArrowhead(makeParent(), TIP, 1, 0, -1, "Filled", BLACK, 0, "t", 1),
    ).toBeNull();
  });

  it("returns null for an unknown arrow kind", () => {
    expect(
      buildArrowhead(makeParent(), TIP, 1, 0, 3, "Unknown", BLACK, 0, "t", 1),
    ).toBeNull();
  });

  it("normalises a non-unit direction without error", () => {
    const parent = makeParent();
    const res = buildArrowhead(
      parent,
      TIP,
      5,
      0,
      3,
      "Filled",
      BLACK,
      0,
      "t",
      1,
    );
    expect(res).not.toBeNull();
    expect(() => res?.dispose()).not.toThrow();
  });

  it("builds a non-pickable Filled triangle child, filled in the arrow colour", () => {
    const parent = makeParent();
    const res = buildArrowhead(
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Filled",
      [255, 0, 0],
      0,
      "filled",
      1,
    );
    expect(res).not.toBeNull();
    const g = parent.getChildByLabel("filled", true);
    if (!(g instanceof Graphics)) throw new Error("expected the arrow graphic");
    expect(g.eventMode).toBe("none");
    expect(styleOf(g, "fill")?.color).toBe(0xff0000);
    expect(() => res?.dispose()).not.toThrow();
  });

  it("builds an Open chevron stroked at the given strokeWidth", () => {
    const parent = makeParent();
    const res = buildArrowhead(
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Open",
      [0, 255, 0],
      0,
      "open",
      2.5,
    );
    expect(res).not.toBeNull();
    const g = parent.getChildByLabel("open", true);
    if (!(g instanceof Graphics)) throw new Error("expected the arrow graphic");
    const style = styleOf(g, "stroke");
    expect(style?.color).toBe(0x00ff00);
    expect(style?.width).toBe(2.5);
  });

  it("builds a Half wing stroked at the given strokeWidth", () => {
    const parent = makeParent();
    const res = buildArrowhead(
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Half",
      [0, 0, 255],
      0,
      "half",
      1.5,
    );
    expect(res).not.toBeNull();
    const g = parent.getChildByLabel("half", true);
    if (!(g instanceof Graphics)) throw new Error("expected the arrow graphic");
    const style = styleOf(g, "stroke");
    expect(style?.color).toBe(0x0000ff);
    expect(style?.width).toBe(1.5);
  });

  it("dispose removes the arrow graphic from its parent", () => {
    const parent = makeParent();
    const res = buildArrowhead(
      parent,
      TIP,
      1,
      0,
      DEFAULT_ARROW_SIZE,
      "Filled",
      BLACK,
      0,
      "disposable",
      1,
    );
    expect(parent.getChildByLabel("disposable", true)).not.toBeNull();
    res?.dispose();
    expect(parent.getChildByLabel("disposable", true)).toBeNull();
  });
});
