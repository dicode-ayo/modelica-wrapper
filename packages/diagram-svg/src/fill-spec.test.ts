import { describe, expect, it } from "vitest";

import {
  fillSpec,
  DEFAULT_EDGE_COLOR,
  HATCH_SPACING,
  HATCH_LINE_WIDTH,
  type Color,
} from "./index.js";

const FILL: Color = [192, 192, 192];
const LINE: Color = [64, 64, 64];

describe("fillSpec", () => {
  it("None pattern yields no fill", () => {
    expect(
      fillSpec({ fillColor: FILL, lineColor: LINE, pattern: "None" }),
    ).toEqual({ kind: "none" });
  });

  it("Solid pattern yields a flat fill in fillColor", () => {
    expect(
      fillSpec({ fillColor: FILL, lineColor: LINE, pattern: "Solid" }),
    ).toEqual({ kind: "solid", color: FILL });
  });

  it("unknown pattern falls back to solid fillColor", () => {
    expect(
      fillSpec({ fillColor: FILL, lineColor: LINE, pattern: "Bogus" }),
    ).toEqual({ kind: "solid", color: FILL });
  });

  it("missing fillColor yields no fill even for a solid pattern", () => {
    expect(
      fillSpec({ fillColor: undefined, lineColor: LINE, pattern: "Solid" }),
    ).toEqual({ kind: "none" });
  });

  describe("gradients", () => {
    it("HorizontalCylinder is a vertical-axis linear gradient line→fill→line", () => {
      const spec = fillSpec({
        fillColor: FILL,
        lineColor: LINE,
        pattern: "HorizontalCylinder",
      });
      expect(spec).toEqual({
        kind: "linear-gradient",
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 1,
        stops: [
          { offset: 0, color: LINE },
          { offset: 0.5, color: FILL },
          { offset: 1, color: LINE },
        ],
      });
    });

    it("VerticalCylinder is a horizontal-axis linear gradient", () => {
      const spec = fillSpec({
        fillColor: FILL,
        lineColor: LINE,
        pattern: "VerticalCylinder",
      });
      expect(spec).toMatchObject({
        kind: "linear-gradient",
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
      });
    });

    it("Sphere is a radial gradient fill-center → line-rim", () => {
      const spec = fillSpec({
        fillColor: FILL,
        lineColor: LINE,
        pattern: "Sphere",
      });
      expect(spec).toEqual({
        kind: "radial-gradient",
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        stops: [
          { offset: 0, color: FILL },
          { offset: 1, color: LINE },
        ],
      });
    });

    it("uses black for the edge when lineColor is absent — no darken math", () => {
      const spec = fillSpec({
        fillColor: [200, 100, 50],
        lineColor: undefined,
        pattern: "HorizontalCylinder",
      });
      expect(spec).toMatchObject({
        kind: "linear-gradient",
        stops: [
          { offset: 0, color: DEFAULT_EDGE_COLOR },
          { offset: 0.5, color: [200, 100, 50] },
          { offset: 1, color: DEFAULT_EDGE_COLOR },
        ],
      });
    });

    it("a gradient with no fillColor has nothing to shade", () => {
      expect(
        fillSpec({
          fillColor: undefined,
          lineColor: LINE,
          pattern: "Sphere",
        }),
      ).toEqual({ kind: "none" });
    });
  });

  describe("hatches", () => {
    const cases: Array<[string, string]> = [
      ["Horizontal", "horizontal"],
      ["Vertical", "vertical"],
      ["Cross", "cross"],
      ["Forward", "forward"],
      ["Backward", "backward"],
      ["CrossDiag", "cross-diag"],
    ];

    it.each(cases)(
      "%s maps to a %s hatch of lineColor over fillColor",
      (pattern, direction) => {
        const spec = fillSpec({ fillColor: FILL, lineColor: LINE, pattern });
        expect(spec).toEqual({
          kind: "hatch",
          direction,
          line: LINE,
          background: FILL,
          spacing: HATCH_SPACING,
          lineWidth: HATCH_LINE_WIDTH,
        });
      },
    );

    it("uses black lines when lineColor is absent", () => {
      const spec = fillSpec({
        fillColor: FILL,
        lineColor: undefined,
        pattern: "Forward",
      });
      expect(spec).toMatchObject({ kind: "hatch", line: DEFAULT_EDGE_COLOR });
    });
  });
});
