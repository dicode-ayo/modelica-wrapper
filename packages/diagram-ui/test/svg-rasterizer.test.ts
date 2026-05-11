import { describe, expect, it } from "vitest";

import { ensureSvgDimensions } from "../src/icon-provider/svg-rasterizer.js";

const SAMPLE_NO_DIM =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">` +
  `<rect x="0" y="0" width="50" height="50" fill="red"/></svg>`;

describe("ensureSvgDimensions", () => {
  it("injects width and height when neither is present", () => {
    const out = ensureSvgDimensions(SAMPLE_NO_DIM, 512);
    expect(out).toMatch(/^<svg width="512" height="512"/);
    expect(out).toContain('viewBox="-100 -100 200 200"');
  });

  it("leaves the SVG unchanged when both dimensions are already set", () => {
    const before =
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" ` +
      `viewBox="-100 -100 200 200"><rect/></svg>`;
    expect(ensureSvgDimensions(before, 512)).toBe(before);
  });

  it("returns the input unchanged when there is no <svg> root tag", () => {
    expect(ensureSvgDimensions("<not-svg/>", 512)).toBe("<not-svg/>");
  });

  it("handles capitalised <SVG> attribute names", () => {
    const before =
      `<SVG xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></SVG>`;
    const out = ensureSvgDimensions(before, 256);
    expect(out).toMatch(/^<svg width="256" height="256"/i);
  });
});
