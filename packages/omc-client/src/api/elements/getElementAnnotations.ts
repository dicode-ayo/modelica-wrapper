/**
 * OMC: `function getElementAnnotations`
 *
 * ```modelica
 * function getElementAnnotations
 *   input TypeName className;
 *   output Expression result;
 * end getElementAnnotations;
 * ```
 *
 * `result` is the per-element annotation list as a Modelica expression tree.
 * Returned as the raw `Value` tree.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetElementAnnotationsInputSchema = TypeNameInput;
export type GetElementAnnotationsInput = z.input<
  typeof GetElementAnnotationsInputSchema
>;

export const GetElementAnnotationsOutputSchema = z.object({
  result: ValueSchema.describe("Per-element annotation list as a Modelica expression tree (raw `Value`)."),
});
export type GetElementAnnotationsOutput = z.infer<
  typeof GetElementAnnotationsOutputSchema
>;

export const GetElementAnnotationsDescription =
  "Return the per-element annotation list of a class as a Modelica expression tree (raw `Value`); callers walk the tree.";

export async function getElementAnnotations(
  ctx: CallContext,
  input: GetElementAnnotationsInput,
): Promise<GetElementAnnotationsOutput> {
  const raw = await ctx.call(`getElementAnnotations(${input.typeName})`);
  return parseOutput(
    GetElementAnnotationsOutputSchema,
    { result: parse(raw) },
    "getElementAnnotations",
  );
}
