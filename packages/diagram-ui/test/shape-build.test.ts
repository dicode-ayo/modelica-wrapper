import { describe, expect, it } from "vitest";

import {
  buildExtentShape,
  buildPolyShape,
  DRAWN_SHAPE_LINE_COLOR,
} from "../src/interaction/shape-build.js";

describe("buildExtentShape", () => {
  it("builds a rectangle / ellipse with a visible outline", () => {
    expect(
      buildExtentShape("rectangle", [
        [0, 0],
        [10, 10],
      ]),
    ).toEqual({
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: DRAWN_SHAPE_LINE_COLOR,
    });
    expect(
      buildExtentShape("ellipse", [
        [0, 0],
        [10, 10],
      ]).kind,
    ).toBe("ellipse");
  });
});

describe("buildPolyShape", () => {
  it("builds an open line carrying its vertices and outline color", () => {
    expect(
      buildPolyShape("line", [
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ).toEqual({
      kind: "line",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      color: DRAWN_SHAPE_LINE_COLOR,
    });
  });

  it("builds a polygon with the distinct vertices and a line color", () => {
    const poly = buildPolyShape("polygon", [
      [0, 0],
      [10, 0],
      [5, 10],
    ]);
    expect(poly.kind).toBe("polygon");
    expect(poly).toEqual({
      kind: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
      lineColor: DRAWN_SHAPE_LINE_COLOR,
    });
  });
});
