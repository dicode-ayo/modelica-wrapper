/**
 * Unit coverage for `decodeAnnotationShape` — the bridge from a
 * `getIconAnnotation` graphic record (a `parse.ts` Value tree) to a typed
 * Shape, used by the write path to round-trip existing graphics through the
 * named-arg serializer.
 *
 * The decisive case is Text: OMC emits its positional record with an empty
 * `textStyle={}`, which its own annotation parser then rejects. Decoding and
 * re-serializing must drop that empty array.
 */

import { describe, expect, it } from "vitest";

import { parse } from "../../parse.js";
import { decodeAnnotationShape } from "./shapes.js";
import { shapeToRecord } from "./shape-serialize.js";

/** A graphic record as OMC hands it back: a fully-positional `call` Value. */
const POSITIONAL_TEXT =
  "Text(true, {0, 0}, 0, {0, 128, 0}, {0, 0, 0}, LinePattern.Solid, " +
  'FillPattern.None, 0.25, {{-30, -10}, {30, 10}}, "hi", 0, {-1, -1, -1}, ' +
  '"", {}, TextAlignment.Center)';

const POSITIONAL_RECTANGLE =
  "Rectangle(true, {0, 0}, 0, {0, 0, 255}, {0, 0, 0}, LinePattern.Solid, " +
  "FillPattern.None, 0.25, BorderPattern.None, {{-40, -40}, {40, 40}}, 0)";

describe("decodeAnnotationShape", () => {
  it("decodes a positional Text record from an Icon annotation", () => {
    const shape = decodeAnnotationShape(parse(POSITIONAL_TEXT));
    expect(shape.kind).toBe("text");
    if (shape.kind !== "text") throw new Error("unreachable");
    expect(shape.textString).toBe("hi");
    expect(shape.extent).toEqual([
      [-30, -10],
      [30, 10],
    ]);
  });

  it("re-serializes a decoded Text without the un-parseable empty textStyle", () => {
    const shape = decodeAnnotationShape(parse(POSITIONAL_TEXT));
    expect(shapeToRecord(shape)).not.toContain("textStyle");
  });

  it("round-trips a positional Rectangle through decode + re-serialize", () => {
    const shape = decodeAnnotationShape(parse(POSITIONAL_RECTANGLE));
    expect(shape.kind).toBe("rectangle");
    const re = shapeToRecord(shape);
    expect(re).toContain("extent={{-40, -40}, {40, 40}}");
    expect(re).toContain("lineColor={0, 0, 255}");
  });

  it("throws on a non-record Value", () => {
    expect(() => decodeAnnotationShape(parse("42"))).toThrow();
  });
});
