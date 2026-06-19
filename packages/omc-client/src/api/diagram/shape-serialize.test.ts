/**
 * Unit coverage for the §18.6 shape serializer.
 *
 * `shapeToRecord` emits NAMED args; OMC normalizes them to positional records
 * on the next read, so true round-trip losslessness is proven against live OMC
 * in `extension/src/diagram/graphics-roundtrip.integration.test.ts`. Here we
 * pin the serializer's own contract: parse the emitted record and assert each
 * field landed with the right name, enum qualifier, and nesting, and that
 * absent optionals are omitted.
 */

import { describe, expect, it } from "vitest";

import { parse, type Value } from "../../parse.js";
import type {
  BitmapShape,
  EllipseShape,
  LineShape,
  PolygonShape,
  RectangleShape,
  TextShape,
} from "../../_shared/diagramLayout.js";
import { shapeToRecord } from "./shape-serialize.js";

/** Parse a serialized record into its name + named-argument map. */
function record(src: string): { name: string; kwargs: Map<string, Value> } {
  const v = parse(src);
  if (v.kind !== "call") throw new Error(`expected a call, got ${v.kind}`);
  const kwargs = new Map<string, Value>();
  for (const arg of v.args) {
    if (arg.kind === "kwarg") kwargs.set(arg.name, arg.value);
  }
  return { name: v.name, kwargs };
}

const ident = (name: string): Value => ({ kind: "ident", name });
const ints = (...xs: number[]): Value => ({
  kind: "list",
  items: xs.map((x) => ({ kind: "int", value: x })),
});

describe("shapeToRecord", () => {
  it("serializes a Rectangle with filled-shape and border fields", () => {
    const s: RectangleShape = {
      kind: "rectangle",
      extent: [
        [-40, -40],
        [40, 40],
      ],
      lineColor: [0, 0, 255],
      fillColor: [255, 0, 0],
      pattern: "Dash",
      fillPattern: "Cross",
      borderPattern: "Raised",
      lineThickness: 1.5,
      radius: 4,
      rotation: 90,
    };
    const { name, kwargs } = record(shapeToRecord(s));
    expect(name).toBe("Rectangle");
    expect(kwargs.get("extent")).toEqual({
      kind: "list",
      items: [ints(-40, -40), ints(40, 40)],
    });
    expect(kwargs.get("lineColor")).toEqual(ints(0, 0, 255));
    expect(kwargs.get("fillColor")).toEqual(ints(255, 0, 0));
    expect(kwargs.get("pattern")).toEqual(ident("LinePattern.Dash"));
    expect(kwargs.get("fillPattern")).toEqual(ident("FillPattern.Cross"));
    expect(kwargs.get("borderPattern")).toEqual(ident("BorderPattern.Raised"));
    expect(kwargs.get("lineThickness")).toEqual({ kind: "float", value: 1.5 });
    expect(kwargs.get("radius")).toEqual({ kind: "int", value: 4 });
    expect(kwargs.get("rotation")).toEqual({ kind: "int", value: 90 });
  });

  it("omits absent optionals, keeping only the required extent", () => {
    const s: RectangleShape = {
      kind: "rectangle",
      extent: [
        [0, 0],
        [1, 1],
      ],
    };
    const { kwargs } = record(shapeToRecord(s));
    expect([...kwargs.keys()]).toEqual(["extent"]);
  });

  it("serializes a Line with arrow, smooth, and color (not lineColor)", () => {
    const s: LineShape = {
      kind: "line",
      points: [
        [0, 0],
        [10, 10],
      ],
      color: [1, 2, 3],
      pattern: "Dot",
      arrow: ["None", "Filled"],
      smooth: "Bezier",
      thickness: 0.5,
    };
    const { name, kwargs } = record(shapeToRecord(s));
    expect(name).toBe("Line");
    expect(kwargs.has("lineColor")).toBe(false);
    expect(kwargs.get("color")).toEqual(ints(1, 2, 3));
    expect(kwargs.get("points")).toEqual({
      kind: "list",
      items: [ints(0, 0), ints(10, 10)],
    });
    expect(kwargs.get("arrow")).toEqual({
      kind: "list",
      items: [ident("Arrow.None"), ident("Arrow.Filled")],
    });
    expect(kwargs.get("pattern")).toEqual(ident("LinePattern.Dot"));
    expect(kwargs.get("smooth")).toEqual(ident("Smooth.Bezier"));
  });

  it("serializes a Polygon with points and smooth", () => {
    const s: PolygonShape = {
      kind: "polygon",
      points: [
        [0, 0],
        [5, 5],
        [10, 0],
      ],
      fillPattern: "VerticalCylinder",
      smooth: "None",
    };
    const { name, kwargs } = record(shapeToRecord(s));
    expect(name).toBe("Polygon");
    expect(kwargs.get("fillPattern")).toEqual(
      ident("FillPattern.VerticalCylinder"),
    );
    expect(kwargs.get("smooth")).toEqual(ident("Smooth.None"));
    expect(kwargs.get("points")).toEqual({
      kind: "list",
      items: [ints(0, 0), ints(5, 5), ints(10, 0)],
    });
  });

  it("serializes an Ellipse with angles and closure", () => {
    const s: EllipseShape = {
      kind: "ellipse",
      extent: [
        [1, 1],
        [2, 2],
      ],
      startAngle: 10,
      endAngle: 90,
      closure: "Radial",
    };
    const { name, kwargs } = record(shapeToRecord(s));
    expect(name).toBe("Ellipse");
    expect(kwargs.get("startAngle")).toEqual({ kind: "int", value: 10 });
    expect(kwargs.get("endAngle")).toEqual({ kind: "int", value: 90 });
    expect(kwargs.get("closure")).toEqual(ident("EllipseClosure.Radial"));
  });

  it("serializes a Text with a plain-string textString and styles", () => {
    const s: TextShape = {
      kind: "text",
      extent: [
        [-30, -10],
        [30, 10],
      ],
      textString: "hi",
      textColor: [0, 128, 0],
      fontName: "Arial",
      textStyle: ["Bold", "Italic"],
      horizontalAlignment: "Left",
    };
    const { name, kwargs } = record(shapeToRecord(s));
    expect(name).toBe("Text");
    expect(kwargs.get("textString")).toEqual({ kind: "string", value: "hi" });
    expect(kwargs.get("fontName")).toEqual({ kind: "string", value: "Arial" });
    expect(kwargs.get("textColor")).toEqual(ints(0, 128, 0));
    expect(kwargs.get("textStyle")).toEqual({
      kind: "list",
      items: [ident("TextStyle.Bold"), ident("TextStyle.Italic")],
    });
    expect(kwargs.get("horizontalAlignment")).toEqual(
      ident("TextAlignment.Left"),
    );
  });

  it("omits an empty textStyle (OMC rejects an empty array literal)", () => {
    const s: TextShape = {
      kind: "text",
      extent: [
        [-30, -10],
        [30, 10],
      ],
      textString: "hi",
      textStyle: [],
    };
    const { kwargs } = record(shapeToRecord(s));
    expect(kwargs.has("textStyle")).toBe(false);
  });

  it("serializes a Bitmap with extent and sources", () => {
    const s: BitmapShape = {
      kind: "bitmap",
      extent: [
        [-10, -10],
        [10, 10],
      ],
      fileName: "modelica://Foo/bar.png",
      imageSource: "iVBORw0",
    };
    const { name, kwargs } = record(shapeToRecord(s));
    expect(name).toBe("Bitmap");
    expect(kwargs.get("fileName")).toEqual({
      kind: "string",
      value: "modelica://Foo/bar.png",
    });
    expect(kwargs.get("imageSource")).toEqual({
      kind: "string",
      value: "iVBORw0",
    });
  });
});
