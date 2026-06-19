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
 * so `modify`/`delete` address a shape by its index in the layer's graphics
 * list (the same order `getIconAnnotation` returns).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { ShapeSchema } from "../../_shared/diagramLayout.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import type { Value } from "../../parse.js";
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

const GRAPHICS_INDEX = 8;

function asNumber(v: Value | undefined): number | null {
  return v && (v.kind === "int" || v.kind === "float") ? v.value : null;
}

/**
 * Reconstruct the `coordinateSystem(...)` clause from the leading Value-tree
 * slots OMC flattens it into: `[x1, y1, x2, y2, preserveAspectRatio,
 * initialScale, gridX, gridY]` (each `null` when at its default). Every
 * non-default field is carried through — `addClassAnnotation` replaces the
 * whole Icon, so a field left out here is lost on any graphics edit. Returns
 * `null` when every slot is at its default (no clause needed).
 */
function coordinateSystemClause(items: Value[]): string | null {
  const parts: string[] = [];
  const x1 = asNumber(items[0]);
  const y1 = asNumber(items[1]);
  const x2 = asNumber(items[2]);
  const y2 = asNumber(items[3]);
  if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
    parts.push(`extent={{${x1}, ${y1}}, {${x2}, ${y2}}}`);
  }
  const preserveAspectRatio = items[4];
  if (preserveAspectRatio?.kind === "bool") {
    parts.push(
      `preserveAspectRatio=${preserveAspectRatio.value ? "true" : "false"}`,
    );
  }
  const initialScale = asNumber(items[5]);
  if (initialScale !== null) parts.push(`initialScale=${initialScale}`);
  const gridX = asNumber(items[6]);
  const gridY = asNumber(items[7]);
  if (gridX !== null && gridY !== null) parts.push(`grid={${gridX}, ${gridY}}`);

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

  const items = annotation.kind === "list" ? annotation.items : [];
  const graphicsValue = items.at(GRAPHICS_INDEX);
  const existing =
    graphicsValue && graphicsValue.kind === "list" ? graphicsValue.items : [];

  const shapes = existing.map(decodeAnnotationShape);
  if (op.kind === "add") {
    shapes.push(op.shape);
  } else {
    if (op.index >= shapes.length) {
      throw new Error(
        `writeClassGraphics: index ${op.index} out of range (${shapes.length} ${layer} shapes)`,
      );
    }
    if (op.kind === "modify") shapes[op.index] = op.shape;
    else shapes.splice(op.index, 1);
  }

  const head = layer === "icon" ? "Icon" : "Diagram";
  const coordSys = coordinateSystemClause(items);
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
