import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";

import { buildStroke, worldScaleOf } from "../src/primitives/shape-utils.js";

function makeScene(): { parent: Container } {
  return { parent: new Container({ label: "parent" }) };
}

const RED: Color = [255, 0, 0];

/** Read the style of a Graphics' first fill/stroke instruction. */
interface DrawStyle {
  color: number;
  pixelLine?: boolean;
  cap?: string;
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

describe("worldScaleOf", () => {
  it("is the geometric mean of |x|/|y| scale, sign-safe and floored", () => {
    const n = new Container({ label: "n" });

    n.scale.set(1, 1);
    expect(worldScaleOf(n)).toBeCloseTo(1);

    n.scale.set(0.1, 0.1);
    expect(worldScaleOf(n)).toBeCloseTo(0.1);

    // Non-square + mirrored: |(-0.2) * 0.05| = 0.01 → 0.1, never negative.
    n.scale.set(-0.2, 0.05);
    expect(worldScaleOf(n)).toBeCloseTo(0.1);

    // Degenerate zero scale falls back to 1 (no divide-by-zero radius).
    n.scale.set(0, 0);
    expect(worldScaleOf(n)).toBe(1);
  });
});

describe("buildStroke", () => {
  it("returns null for a non-drawable stroke", () => {
    const { parent } = makeScene();
    expect(buildStroke(parent, [[0, 0]], RED, undefined, 0, "s")).toBeNull();
    expect(
      buildStroke(
        parent,
        [
          [0, 0],
          [1, 1],
        ],
        RED,
        "None",
        0,
        "s",
      ),
    ).toBeNull();
    // All-equal points → no segment → null.
    expect(
      buildStroke(
        parent,
        [
          [5, 5],
          [5, 5],
        ],
        RED,
        undefined,
        0,
        "s",
      ),
    ).toBeNull();
  });

  it("builds a solid stroke as a non-pickable world-frame band in the stroke colour", () => {
    const { parent } = makeScene();
    const res = buildStroke(
      parent,
      [
        [0, 0],
        [10, 0],
      ],
      RED,
      undefined,
      0,
      "stroke",
    );
    expect(res).not.toBeNull();
    const g = parent.getChildByLabel("stroke", true);
    if (!(g instanceof Graphics))
      throw new Error("expected the stroke graphic");
    expect(g.eventMode).toBe("none");
    const style = styleOf(g, "stroke");
    // Stroke colour is the packed RED (0xff0000) — full red, no green.
    expect(style?.color).toBe(0xff0000);
    // Solid strokes ride the world transform (round cap, not a 1-px GL line).
    expect(style?.cap).toBe("round");
    expect(style?.pixelLine).toBe(false);
  });

  it("builds a dashed stroke at the same scale-compensated band as solid", () => {
    const { parent } = makeScene();
    const res = buildStroke(
      parent,
      [
        [0, 0],
        [10, 0],
      ],
      RED,
      "Dash",
      0,
      "dashed",
    );
    expect(res).not.toBeNull();
    const g = parent.getChildByLabel("dashed", true);
    if (!(g instanceof Graphics))
      throw new Error("expected the dashed graphic");
    expect(g.eventMode).toBe("none");
    const style = styleOf(g, "stroke");
    expect(style?.color).toBe(0xff0000);
    // Dashed honours the same scale-compensated round-cap band as solid —
    // only the path is segmented, so it is not a 1-px GL line.
    expect(style?.cap).toBe("round");
    expect(style?.pixelLine).toBe(false);
  });
});
