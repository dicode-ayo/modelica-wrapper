import { describe, expect, it } from "vitest";
import type { Box } from "../base/placement-math.js";
import {
  NESTING_THRESHOLDS,
  letterbox,
  nestingProgress,
} from "./nesting-math.js";

const SQUARE: Box = { width: 200, height: 200, cx: 0, cy: 0 };

describe("nestingProgress", () => {
  it("is closed at and below the exit size", () => {
    expect(nestingProgress(140)).toBe(0);
    expect(nestingProgress(10)).toBe(0);
  });

  it("is fully open at and above the enter size", () => {
    expect(nestingProgress(200)).toBe(1);
    expect(nestingProgress(5000)).toBe(1);
  });

  it("sits at one half mid-band", () => {
    expect(nestingProgress(170)).toBeCloseTo(0.5);
  });

  it("depends on size alone, so reversing a zoom retraces the same values", () => {
    const sizes = [120, 150, 175, 199, 230];
    const forward = sizes.map((s) => nestingProgress(s));
    const backward = [...sizes].reverse().map((s) => nestingProgress(s));
    expect(backward).toEqual([...forward].reverse());
  });

  it("treats a non-finite size as closed", () => {
    expect(nestingProgress(Number.NaN)).toBe(0);
    expect(nestingProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("ships an enter size above its exit size", () => {
    expect(NESTING_THRESHOLDS.enterPx).toBeGreaterThan(
      NESTING_THRESHOLDS.exitPx,
    );
  });
});

describe("letterbox", () => {
  const UNIT = { x: 1, y: 1 };

  it("maps an identical box to identity", () => {
    expect(letterbox(SQUARE, SQUARE, UNIT)).toEqual({
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    });
  });

  it("scales uniformly by the tighter axis of a wide box", () => {
    const fit = letterbox(
      SQUARE,
      { width: 400, height: 100, cx: 0, cy: 0 },
      UNIT,
    );
    expect(fit).toEqual({ scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 });
  });

  it("centres off-origin content on an off-origin box", () => {
    const content: Box = { width: 100, height: 100, cx: 50, cy: 50 };
    const fit = letterbox(
      content,
      { width: 20, height: 20, cx: 20, cy: 30 },
      UNIT,
    );
    expect(fit.scaleX).toBe(0.2);
    expect(50 * fit.scaleX + fit.x).toBeCloseTo(20);
    expect(50 * fit.scaleY + fit.y).toBeCloseTo(30);
  });

  it("stays uniform on screen under a non-uniform placement scale", () => {
    // A square icon placed into a 2:1 extent is squashed 0.2 × 0.1.
    const boxScale = { x: 0.2, y: 0.1 };
    const fit = letterbox(SQUARE, SQUARE, boxScale);
    expect(fit.scaleX * boxScale.x).toBeCloseTo(fit.scaleY * boxScale.y);
    // The tighter on-screen axis (height, 20 units) decides: 20 / 200.
    expect(fit.scaleY * boxScale.y).toBeCloseTo(0.1);
  });

  it("undoes a mirrored placement rather than mirroring the content", () => {
    const boxScale = { x: -0.1, y: 0.1 };
    const fit = letterbox(SQUARE, SQUARE, boxScale);
    expect(fit.scaleX * boxScale.x).toBeGreaterThan(0);
    expect(fit.scaleY * boxScale.y).toBeGreaterThan(0);
  });

  it("falls back to identity scale for a degenerate content box", () => {
    const flat: Box = { width: 0, height: 0, cx: 0, cy: 0 };
    expect(letterbox(flat, SQUARE, UNIT).scaleX).toBe(1);
  });
});
