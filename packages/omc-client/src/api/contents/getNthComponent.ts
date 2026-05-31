/**
 * OMC: `function getNthComponent`
 *
 * Returns the type, name, and description string of the n-th component in a
 * class, as a Modelica expression tree.
 *
 * ```modelica
 * function getNthComponent
 *   input TypeName className;
 *   input Integer n;
 *   output Expression result;
 * end getNthComponent;
 * ```
 *
 * `result` is returned as the raw `Value` tree (per audit.md §2.4 for
 * `Expression` outputs); callers project the `(type, name, comment)` tuple.
 * `n` is 1-based, in `1..getComponentCount`. For richer structured reads,
 * prefer `getModelInstance`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthComponentInputSchema = TypeNameInput.extend({
  n: z
    .number()
    .int()
    .positive()
    .describe("1-based component index, between 1 and `getComponentCount`."),
});
export type GetNthComponentInput = z.input<typeof GetNthComponentInputSchema>;

export const GetNthComponentOutputSchema = z.object({
  result: ValueSchema.describe(
    "Type, name, and description of the n-th component as a Modelica expression tree (raw `Value`).",
  ),
});
export type GetNthComponentOutput = z.infer<typeof GetNthComponentOutputSchema>;

export const GetNthComponentDescription =
  "Return the type, name, and description string of the n-th component in a class as a Modelica expression tree. Pairs with `getComponentCount`; prefer `getModelInstance` for a richer read.";

export async function getNthComponent(
  ctx: CallContext,
  input: GetNthComponentInput,
): Promise<GetNthComponentOutput> {
  const raw = await ctx.call(`getNthComponent(${input.typeName}, ${input.n})`);
  return parseOutput(
    GetNthComponentOutputSchema,
    { result: parse(raw) },
    "getNthComponent",
  );
}
