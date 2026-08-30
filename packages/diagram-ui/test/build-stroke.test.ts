import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";

import {
  buildStroke,
  resolveStrokeWidth,
  strokeFloorClamps,
  worldScaleOf,
} from "../src/primitives/shape-utils.js";
import { dashCount } from "./pixi-dash.helper.js";

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

describe("resolveStrokeWidth", () => {
  it("keeps the 0.25 spec default literal when it clears the screen-space floor", () => {
    const parent = new Container();
    // Zoomed in: one screen px is 0.05 diagram units, well under 0.25 —
    // the default thickness must NOT be inflated (the pre-floor 0.5-unit
    // minimum doubled it at every zoom).
    expect(resolveStrokeWidth(parent, undefined, undefined, 0.05)).toBeCloseTo(
      0.25,
    );
  });

  it("floors the width at one screen pixel when zoomed out", () => {
    const parent = new Container();
    // 2 diagram units per px: 0.25 units would be an eighth of a pixel.
    expect(resolveStrokeWidth(parent, undefined, undefined, 2)).toBeCloseTo(2);
    expect(resolveStrokeWidth(parent, 0.5, undefined, 2)).toBeCloseTo(2);
  });

  it("leaves a thickness above the floor untouched", () => {
    const parent = new Container();
    expect(resolveStrokeWidth(parent, 5, undefined, 2)).toBeCloseTo(5);
  });

  it("applies no floor without a usable worldPerPixel", () => {
    const parent = new Container();
    expect(resolveStrokeWidth(parent, undefined, undefined)).toBeCloseTo(0.25);
    expect(
      resolveStrokeWidth(
        parent,
        undefined,
        undefined,
        Number.POSITIVE_INFINITY,
      ),
    ).toBeCloseTo(0.25);
    expect(resolveStrokeWidth(parent, undefined, undefined, 0)).toBeCloseTo(
      0.25,
    );
  });

  it("divides the parent's world scale out of the floored width", () => {
    const parent = new Container();
    parent.scale.set(0.1, 0.1);
    // Floored to 2 world units, then compensated so the scaled render
    // still comes out at 2.
    expect(resolveStrokeWidth(parent, undefined, undefined, 2)).toBeCloseTo(20);
  });
});

describe("strokeFloorClamps", () => {
  it("reports clamping only while the floor exceeds the natural width", () => {
    expect(strokeFloorClamps(undefined, undefined, 2)).toBe(true);
    expect(strokeFloorClamps(undefined, undefined, 0.05)).toBe(false);
    expect(strokeFloorClamps(5, undefined, 2)).toBe(false);
    expect(strokeFloorClamps(0.25, 100, 2)).toBe(false);
  });

  it("never clamps without a usable worldPerPixel", () => {
    expect(strokeFloorClamps(undefined, undefined, undefined)).toBe(false);
    expect(
      strokeFloorClamps(undefined, undefined, Number.POSITIVE_INFINITY),
    ).toBe(false);
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

  it("scales the dash rhythm by worldPerPixel so it reads a constant size on screen", () => {
    const { parent } = makeScene();
    const longPath: Array<[number, number]> = [
      [0, 0],
      [1000, 0],
    ];
    // Zoomed in (small worldPerPixel) needs a smaller world-space dash
    // period to stay the same screen size, so more dashes fit the path.
    buildStroke(parent, longPath, RED, "Dash", 0, "zoomed-in", {
      worldPerPixel: 0.1,
    });
    // Zoomed out (large worldPerPixel) needs a larger period, so fewer.
    buildStroke(parent, longPath, RED, "Dash", 0, "zoomed-out", {
      worldPerPixel: 5,
    });
    const zoomedIn = parent.getChildByLabel("zoomed-in", true);
    const zoomedOut = parent.getChildByLabel("zoomed-out", true);
    if (!(zoomedIn instanceof Graphics) || !(zoomedOut instanceof Graphics)) {
      throw new Error("expected both dashed graphics");
    }
    expect(dashCount(zoomedIn)).toBeGreaterThan(dashCount(zoomedOut));
  });

  it("without a worldPerPixel, dashes at the raw diagram-unit size (legacy fallback)", () => {
    const { parent } = makeScene();
    const longPath: Array<[number, number]> = [
      [0, 0],
      [1000, 0],
    ];
    buildStroke(parent, longPath, RED, "Dash", 0, "no-wpp");
    buildStroke(parent, longPath, RED, "Dash", 0, "wpp-one", {
      worldPerPixel: 1,
    });
    const noWpp = parent.getChildByLabel("no-wpp", true);
    const wppOne = parent.getChildByLabel("wpp-one", true);
    if (!(noWpp instanceof Graphics) || !(wppOne instanceof Graphics)) {
      throw new Error("expected both dashed graphics");
    }
    // worldScale is 1 here (default container scale), so worldPerPixel=1
    // scales every run by 1 — identical to the no-scaling legacy path.
    expect(dashCount(noWpp)).toBe(dashCount(wppOne));
  });

  it("floors a scaled dash run so an extreme zoom-in can't collapse it to zero", () => {
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
      "floored",
      { worldPerPixel: 1e-9 },
    );
    expect(res).not.toBeNull();
    const g = parent.getChildByLabel("floored", true);
    if (!(g instanceof Graphics)) throw new Error("expected the graphic");
    const count = dashCount(g);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10_000);
  });
});
