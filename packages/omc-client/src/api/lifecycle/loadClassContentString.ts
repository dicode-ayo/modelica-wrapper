/**
 * OMC: `function loadClassContentString`
 *
 * Parse Modelica class elements from a string and insert them into an existing
 * loaded class, optionally shifting graphical Placement annotations by an
 * (offsetX, offsetY). This is the OMC call behind OMEdit's diagram
 * paste/duplicate (`OMCProxy::loadClassContentString`): copied elements are
 * serialized to a string and merged into the target class at a pixel offset.
 *
 * ```modelica
 * function loadClassContentString
 *   input String data;
 *   input TypeName className;
 *   input Integer offsetX = 0;
 *   input Integer offsetY = 0;
 *   output Boolean success;
 * end loadClassContentString;
 * ```
 *
 * The target class must be a long class definition. Sections merge by kind:
 * public/protected combine, equation sections merge with the last of the same
 * type, external declarations overwrite, annotations merge.
 *
 * `data` is a `String` arg and MUST be quoted (audit.md §2.10); `className` is
 * a `TypeName` emitted bare. Verified live on OMC 1.26.7:
 *   - inserting `"Real y;"` into a `model PasteTarget` adds `Real y;` and
 *     returns `true`;
 *   - a `(50, 50)` offset rewrites the inserted component's Placement to
 *     `origin = {50, 50}` before merging.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadClassContentStringInputSchema = z.object({
  data: z
    .string()
    .describe("Modelica class elements to parse and insert into the class."),
  typeName: z
    .string()
    .describe(
      "Fully qualified TypeName of the target class (OMC parameter `className`); emitted bare to OMC.",
    ),
  offsetX: z
    .number()
    .int()
    .optional()
    .default(0)
    .describe("Horizontal offset applied to inserted Placement annotations."),
  offsetY: z
    .number()
    .int()
    .optional()
    .default(0)
    .describe("Vertical offset applied to inserted Placement annotations."),
});
export type LoadClassContentStringInput = z.input<
  typeof LoadClassContentStringInputSchema
>;

export const LoadClassContentStringOutputSchema = SuccessOutput;
export type LoadClassContentStringOutput = z.infer<
  typeof LoadClassContentStringOutputSchema
>;

export const LoadClassContentStringDescription =
  "Load class elements from a string and insert them into the given loaded class, optionally offsetting graphical annotations.";

export async function loadClassContentString(
  ctx: CallContext,
  input: LoadClassContentStringInput,
): Promise<LoadClassContentStringOutput> {
  const raw = await ctx.call(
    `loadClassContentString(${quote(input.data)}, ${input.typeName}, ${input.offsetX ?? 0}, ${input.offsetY ?? 0})`,
  );
  return parseOutput(
    LoadClassContentStringOutputSchema,
    { success: expectBool(parse(raw)) },
    "loadClassContentString",
  );
}
