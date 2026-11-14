import { describe, expect, it } from "vitest";
import type { Box } from "../base/placement-math.js";
import {
  NESTING_LATE_FADE_MS,
  NESTING_THRESHOLDS,
  lateFadeProgress,
  letterbox,
  nestingPrefetches,
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
});

describe("nestingPrefetches", () => {
  it("starts below the fade band, so a growing box has its diagram before it opens", () => {
    const { prefetchPx, exitPx } = NESTING_THRESHOLDS;
    expect(prefetchPx).toBeLessThan(exitPx);
    expect(nestingPrefetches(prefetchPx)).toBe(false);
    expect(nestingPrefetches((prefetchPx + exitPx) / 2)).toBe(true);
    expect(nestingProgress((prefetchPx + exitPx) / 2)).toBe(0);
  });

  it("holds wherever the box is open", () => {
    expect(nestingPrefetches(NESTING_THRESHOLDS.exitPx + 1)).toBe(true);
    expect(nestingPrefetches(5000)).toBe(true);
  });

  it("treats a non-finite size as too small", () => {
    expect(nestingPrefetches(Number.NaN)).toBe(false);
    expect(nestingPrefetches(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("lateFadeProgress", () => {
  it("ramps from 0 to 1 over the late fade, then holds", () => {
    expect(lateFadeProgress(0)).toBe(0);
    expect(lateFadeProgress(NESTING_LATE_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(lateFadeProgress(NESTING_LATE_FADE_MS)).toBe(1);
    expect(lateFadeProgress(NESTING_LATE_FADE_MS * 3)).toBe(1);
  });

  it("stays at 0 for a clock that has not moved forward", () => {
    expect(lateFadeProgress(-5)).toBe(0);
    expect(lateFadeProgress(Number.NaN)).toBe(0);
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
