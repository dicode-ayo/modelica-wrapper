/**
 * OMC: `function getAnnotationNamedModifiers`
 *
 * ```modelica
 * function getAnnotationNamedModifiers
 *   input TypeName className;
 *   input String annotation;
 *   output String[:] result;
 * end getAnnotationNamedModifiers;
 * ```
 *
 * Returns the named modifiers attached to a class-level annotation block
 * (e.g. for an annotation like `Documentation(info="…", revisions="…")`
 * the modifiers are `info` and `revisions`).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAnnotationNamedModifiersInputSchema = TypeNameInput.extend({
  annotation: z
    .string()
    .describe(
      "Name of the annotation block to inspect (e.g. `Documentation`, `Icon`).",
    ),
});
export type GetAnnotationNamedModifiersInput = z.input<
  typeof GetAnnotationNamedModifiersInputSchema
>;

export const GetAnnotationNamedModifiersOutputSchema = z.object({
  result: z
    .array(z.string())
    .describe("Modifier names declared inside the named annotation block."),
});
export type GetAnnotationNamedModifiersOutput = z.infer<
  typeof GetAnnotationNamedModifiersOutputSchema
>;

export const GetAnnotationNamedModifiersDescription =
  "List the modifier names declared inside a class-level annotation block (e.g. `info`, `revisions` for `Documentation`).";

export async function getAnnotationNamedModifiers(
  ctx: CallContext,
  input: GetAnnotationNamedModifiersInput,
): Promise<GetAnnotationNamedModifiersOutput> {
  const raw = await ctx.call(
    `getAnnotationNamedModifiers(${input.typeName}, ${quote(input.annotation)})`,
  );
  return parseOutput(
    GetAnnotationNamedModifiersOutputSchema,
    { result: expectStringList(parse(raw)) },
    "getAnnotationNamedModifiers",
  );
}
