import { describe, expect, it } from "vitest";

import { parse } from "../../parse.js";
import {
  annotationCoordinateSystem,
  annotationGraphics,
} from "./annotation-layout.js";

/** An Icon annotation as OMC flattens it: 8 coordinateSystem slots + graphics. */
const NON_DEFAULT =
  "{-50, -50, 50, 50, false, 0.5, 5, 7, " +
  "{Rectangle(true, {0, 0}, 0), Text(true, {0, 0}, 0)}}";

/** All coordinateSystem slots at default (null), one graphic. */
const DEFAULTS = "{-100, -100, 100, 100, null, null, null, null, {Line(true)}}";

describe("annotationGraphics", () => {
  it("returns the graphic records from the trailing slot", () => {
    expect(
      annotationGraphics(parse(NON_DEFAULT)).map((g) =>
        g.kind === "call" ? g.name : g.kind,
      ),
    ).toEqual(["Rectangle", "Text"]);
  });

  it("returns [] when the annotation is not a list", () => {
    expect(annotationGraphics(parse("42"))).toEqual([]);
  });
});

describe("annotationCoordinateSystem", () => {
  it("reads every non-default coordinateSystem field", () => {
    expect(annotationCoordinateSystem(parse(NON_DEFAULT))).toEqual({
      extent: [-50, -50, 50, 50],
      preserveAspectRatio: false,
      initialScale: 0.5,
      grid: [5, 7],
    });
  });

  it("maps null slots to null fields, keeping the extent", () => {
    expect(annotationCoordinateSystem(parse(DEFAULTS))).toEqual({
      extent: [-100, -100, 100, 100],
      preserveAspectRatio: null,
      initialScale: null,
      grid: null,
    });
  });
});
