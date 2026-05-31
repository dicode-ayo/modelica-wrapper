/**
 * OMC: `function getElements`
 *
 * ```modelica
 * function getElements
 *   input TypeName className;
 *   input Boolean useQuotes = false;
 * end getElements;
 * ```
 *
 * The output is `external "C"` and not declared in the public signature: it's
 * a 2D-ish list per element (analogous to `getComponents`). Output here is
 * exposed as the raw `Value` tree; callers walk the structure.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetElementsInputSchema = z.object({
  typeName: z.string().describe("Class whose elements should be enumerated."),
  useQuotes: z
    .boolean()
    .optional()
    .default(false)
    .describe("Quote string-typed fields in the result when true."),
});
export type GetElementsInput = z.input<typeof GetElementsInputSchema>;

export const GetElementsOutputSchema = z.object({
  elements: ValueSchema.describe(
    "Element rows as a Modelica expression tree (raw `Value`); shape varies across OMC versions.",
  ),
});
export type GetElementsOutput = z.infer<typeof GetElementsOutputSchema>;

export const GetElementsDescription =
  "Return all elements declared in a class (extends, components, short class definitions) as the raw `Value` tree; callers walk the structure.";

export async function getElements(
  ctx: CallContext,
  input: GetElementsInput,
): Promise<GetElementsOutput> {
  const useQuotes = input.useQuotes ?? false;
  const raw = await ctx.call(
    `getElements(${input.typeName}, useQuotes=${mlBool(useQuotes)})`,
  );
  return parseOutput(
    GetElementsOutputSchema,
    { elements: parse(raw) },
    "getElements",
  );
}
