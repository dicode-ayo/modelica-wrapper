/**
 * Add / modify / delete a single graphic primitive in a class's `Icon` or
 * `Diagram` annotation.
 *
 * `addClassAnnotation` REPLACES the whole layer annotation, so this reads the
 * current annotation first and re-emits the coordinateSystem extent alongside
 * the edited graphics list — dropping either would silently lose it.
 *
 * Existing shapes are re-serialized, not echoed verbatim: OMC returns each
 * graphic as a fully-positional record that can include an empty `textStyle={}`
 * array literal, which OMC's own annotation parser then rejects (Modelica can't
 * type an empty array). So existing graphics are decoded to typed shapes and
 * re-emitted through {@link shapeToRecord} — the same named-arg path new shapes
 * take, which drops empty/default fields.
 *
 * Shape identity is positional `(layer, index)`: Modelica graphics have no id,
 * so `modify`/`delete`/`reorder` address a shape by its index in the layer's
 * graphics list (the same order `getIconAnnotation` returns).
 *
 * Array order is also paint order (first = bottom), so `reorder` is what
 * bring-to-front / send-to-back write. OMC exposes no reorder call; since this
 * function already rewrites the whole array, the move happens here.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { ShapeSchema, moveWithin } from "../../_shared/diagramLayout.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import {
  annotationCoordinateSystem,
  annotationGraphics,
  type CoordinateSystemFields,
} from "../diagram/annotation-layout.js";
import { getDiagramAnnotation } from "../contents/getDiagramAnnotation.js";
import { getIconAnnotation } from "../contents/getIconAnnotation.js";
import { shapeToRecord } from "../diagram/shape-serialize.js";
import { decodeAnnotationShape } from "../diagram/shapes.js";
import { addClassAnnotation } from "./addClassAnnotation.js";

const NonNegativeIndex = z.number().int().nonnegative();

export const WriteClassGraphicsInputSchema = z.object({
  typeName: z.string().describe("Class whose graphics layer is edited."),
  layer: z
    .union([z.literal("icon"), z.literal("diagram")])
    .describe("Which annotation layer to edit."),
  op: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("add"), shape: ShapeSchema }),
      z.object({
        kind: z.literal("modify"),
        index: NonNegativeIndex,
        shape: ShapeSchema,
      }),
      z.object({ kind: z.literal("delete"), index: NonNegativeIndex }),
      z.object({
        kind: z.literal("reorder"),
        from: NonNegativeIndex,
        to: NonNegativeIndex,
      }),
    ])
    .describe("Edit to apply to the layer's positional graphics list."),
});
export type WriteClassGraphicsInput = z.infer<
  typeof WriteClassGraphicsInputSchema
>;

export const WriteClassGraphicsOutputSchema = SuccessOutput;
export type WriteClassGraphicsOutput = z.infer<
  typeof WriteClassGraphicsOutputSchema
>;

export const WriteClassGraphicsDescription =
  "Add, modify, or delete one graphic primitive in a class's Icon or Diagram annotation, preserving the other shapes and the coordinate system.";

/**
 * Reconstruct the `coordinateSystem(...)` clause, carrying through every
 * non-default field — `addClassAnnotation` replaces the whole Icon, so a field
 * left out here is lost on any graphics edit. Returns `null` when every field
 * is at its default (no clause needed).
 */
function coordinateSystemClause(cs: CoordinateSystemFields): string | null {
  const parts: string[] = [];
  if (cs.extent) {
    const [x1, y1, x2, y2] = cs.extent;
    parts.push(`extent={{${x1}, ${y1}}, {${x2}, ${y2}}}`);
  }
  if (cs.preserveAspectRatio !== null) {
    parts.push(
      `preserveAspectRatio=${cs.preserveAspectRatio ? "true" : "false"}`,
    );
  }
  if (cs.initialScale !== null) parts.push(`initialScale=${cs.initialScale}`);
  if (cs.grid) parts.push(`grid={${cs.grid[0]}, ${cs.grid[1]}}`);

  return parts.length > 0 ? `coordinateSystem(${parts.join(", ")})` : null;
}

export async function writeClassGraphics(
  ctx: CallContext,
  input: WriteClassGraphicsInput,
): Promise<WriteClassGraphicsOutput> {
  const { typeName, layer, op } = input;
  const { annotation } =
    layer === "icon"
      ? await getIconAnnotation(ctx, { typeName })
      : await getDiagramAnnotation(ctx, { typeName });

  const shapes = annotationGraphics(annotation).map(decodeAnnotationShape);
  const outOfRange = (i: number): Error =>
    new Error(
      `writeClassGraphics: index ${i} out of range (${shapes.length} ${layer} shapes)`,
    );

  if (op.kind === "add") {
    shapes.push(op.shape);
  } else if (op.kind === "reorder") {
    const moved = moveWithin(shapes, op.from, op.to);
    if (moved === null) {
      throw outOfRange(op.from >= shapes.length ? op.from : op.to);
    }
    shapes.splice(0, shapes.length, ...moved);
  } else {
    if (op.index >= shapes.length) throw outOfRange(op.index);
    if (op.kind === "modify") shapes[op.index] = op.shape;
    else shapes.splice(op.index, 1);
  }

  const head = layer === "icon" ? "Icon" : "Diagram";
  const coordSys = coordinateSystemClause(
    annotationCoordinateSystem(annotation),
  );
  const parts = coordSys ? [coordSys] : [];
  // An empty `graphics={}` array trips the same empty-array typing rule OMC
  // rejects, so omit the clause entirely when the last shape was deleted.
  if (shapes.length > 0) {
    parts.push(`graphics={${shapes.map(shapeToRecord).join(", ")}}`);
  }

  return addClassAnnotation(ctx, {
    typeName,
    annotation: `${head}(${parts.join(", ")})`,
  });
}
