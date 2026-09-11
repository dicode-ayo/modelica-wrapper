/**
 * The seven tools OMEdit spends on graphic primitives, over the one wrapper
 * this package spends on them.
 *
 * `writeClassGraphics` takes a discriminated union of every shape, whose JSON
 * Schema costs more than the rest of the curated set combined — every caller
 * pays for every shape's fields. Split, a model drawing a line never pays for
 * the polygon and text branches, so matching OMEdit's tool count is also the
 * cheaper option here.
 *
 * The schemas here are the tools' own rather than slices of `ShapeSchema`:
 * flattening `extent` to four numbers and dropping the fields a caller drawing
 * by hand never sets is most of what makes the split pay.
 *
 * Shape identity is positional. Modelica graphics have no id, so `removeShape`
 * addresses one by its index in the layer's graphics list — the order
 * `getIconAnnotation` / `getDiagramAnnotation` return.
 */

import {
  ShapeIndexSchema,
  WriteClassGraphicsInputSchema,
  WriteCoordinateSystemSchema,
  type Extent,
  type FilledShape,
  type Shape,
} from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { dispatch, type McpToolDeps } from "./dispatch.js";

const FlatExtent = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe("Bounding box as [x1, y1, x2, y2] in diagram coordinates.");

const Color = z
  .tuple([z.number(), z.number(), z.number()])
  .describe("RGB components, each 0-255.");

const Points = z
  .array(z.tuple([z.number(), z.number()]))
  .describe("Vertices as [x, y] pairs in diagram coordinates.");

/** What every one of these tools reads to find the layer it edits. */
const placed = WriteClassGraphicsInputSchema.pick({
  typeName: true,
  layer: true,
}).shape;

type Placed = z.infer<z.ZodObject<typeof placed>>;

/** The `FilledShape` style fields (Modelica spec §18.6). */
const filled = {
  lineColor: Color.optional(),
  fillColor: Color.optional(),
  lineThickness: z.number().optional(),
  pattern: z
    .string()
    .optional()
    .describe("Outline line pattern, e.g. Solid, Dash, Dot."),
  fillPattern: z
    .string()
    .optional()
    .describe("Interior fill pattern, e.g. None, Solid, HorizontalCylinder."),
} satisfies { [K in keyof Required<FilledShape>]: z.ZodType };

/** `[x1, y1, x2, y2]` as the nested pair Modelica and `ShapeSchema` use. */
function extentOf(flat: [number, number, number, number]): Extent {
  return [
    [flat[0], flat[1]],
    [flat[2], flat[3]],
  ];
}

const RectangleSchema = z.object({
  ...placed,
  extent: FlatExtent,
  radius: z.number().optional().describe("Corner radius."),
  ...filled,
});

const EllipseSchema = z.object({
  ...placed,
  extent: FlatExtent,
  startAngle: z.number().optional().describe("Arc start in degrees."),
  endAngle: z.number().optional().describe("Arc end in degrees."),
  ...filled,
});

const LineSchema = z.object({
  ...placed,
  points: Points,
  color: Color.optional(),
  thickness: z.number().optional(),
  pattern: z.string().optional().describe("Line pattern, e.g. Solid, Dash."),
  arrow: z
    .tuple([z.string(), z.string()])
    .optional()
    .describe("Start and end arrow heads, e.g. [None, Filled]."),
});

const PolygonSchema = z.object({ ...placed, points: Points, ...filled });

const TextSchema = z.object({
  ...placed,
  extent: FlatExtent,
  textString: z
    .string()
    .describe("Text to draw; `%name` and `%par` expand per instance."),
  fontSize: z.number().optional().describe("0 scales the text to `extent`."),
  fontName: z.string().optional(),
  textColor: Color.optional(),
});

const RemoveShapeSchema = z.object({
  ...placed,
  index: ShapeIndexSchema.describe(
    "Position in the layer's graphics list, in the order getIconAnnotation / getDiagramAnnotation return.",
  ),
});

/**
 * Extends the wrapper's own schema rather than restating it: nothing else would
 * fail when a field is added there and silently dropped by the rest spread this
 * tool forwards.
 */
const CoordinateSystemSchema = WriteCoordinateSystemSchema.extend(placed);

export function registerShapeTools(server: McpServer, deps: McpToolDeps): void {
  /**
   * `ToolCallback` is a conditional type on the schema, and nothing is
   * assignable to one that is still generic — so the schema widens here and
   * the input is re-narrowed on the way into the handler.
   */
  const register = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    handle: (input: z.infer<S>) => Promise<CallToolResult>,
  ): void => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema as z.ZodType,
        annotations: { readOnlyHint: false },
      },
      async (input: unknown) => handle(input as z.infer<S>),
    );
  };

  const draws = <S extends z.ZodType<Placed>>(
    name: string,
    description: string,
    schema: S,
    shape: (input: z.infer<S>) => Shape,
  ): void => {
    register(name, description, schema, async (input) =>
      dispatch(deps, "writeClassGraphics", {
        typeName: input.typeName,
        layer: input.layer,
        op: { kind: "add", shape: shape(input) },
      }),
    );
  };

  draws(
    "addRectangle",
    "Draw a rectangle in a class's Icon or Diagram annotation, leaving the existing shapes and coordinate system in place.",
    RectangleSchema,
    (input) => ({
      kind: "rectangle",
      extent: extentOf(input.extent),
      radius: input.radius,
      ...style(input),
    }),
  );

  draws(
    "addEllipse",
    "Draw an ellipse — or an arc, via startAngle/endAngle — in a class's Icon or Diagram annotation.",
    EllipseSchema,
    (input) => ({
      kind: "ellipse",
      extent: extentOf(input.extent),
      startAngle: input.startAngle,
      endAngle: input.endAngle,
      ...style(input),
    }),
  );

  draws(
    "addLine",
    "Draw a polyline in a class's Icon or Diagram annotation. This draws a graphic; connecting two components is addConnection.",
    LineSchema,
    (input) => ({
      kind: "line",
      points: input.points,
      color: input.color,
      thickness: input.thickness,
      pattern: input.pattern,
      arrow: input.arrow,
    }),
  );

  draws(
    "addPolygon",
    "Draw a filled polygon in a class's Icon or Diagram annotation.",
    PolygonSchema,
    (input) => ({
      kind: "polygon",
      points: input.points,
      ...style(input),
    }),
  );

  draws(
    "addText",
    "Draw a text shape in a class's Icon or Diagram annotation. `%name` renders the instance name at each use site.",
    TextSchema,
    (input) => ({
      kind: "text",
      extent: extentOf(input.extent),
      textString: input.textString,
      fontSize: input.fontSize,
      fontName: input.fontName,
      textColor: input.textColor,
    }),
  );

  register(
    "removeShape",
    "Remove one graphic primitive from a class's Icon or Diagram annotation by its position in that layer's graphics list.",
    RemoveShapeSchema,
    async ({ typeName, layer, index }) =>
      dispatch(deps, "writeClassGraphics", {
        typeName,
        layer,
        op: { kind: "delete", index },
      }),
  );

  register(
    "setCoordinateSystem",
    "Set a class's Icon or Diagram coordinate system. Fields left out keep their current value; the layer's shapes are untouched.",
    CoordinateSystemSchema,
    async ({ typeName, layer, ...coordinateSystem }) =>
      dispatch(deps, "writeClassGraphics", {
        typeName,
        layer,
        op: { kind: "setCoordinateSystem", coordinateSystem },
      }),
  );
}

function style(input: FilledShape): FilledShape {
  return {
    lineColor: input.lineColor,
    fillColor: input.fillColor,
    lineThickness: input.lineThickness,
    pattern: input.pattern,
    fillPattern: input.fillPattern,
  };
}
