/**
 * OMC: `function isModel`
 *
 * ```modelica
 * function isModel
 *   input TypeName cl;
 *   output Boolean b;
 * end isModel;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsModelInputSchema = TypeNameInput;
export type IsModelInput = z.input<typeof IsModelInputSchema>;

export const IsModelOutputSchema = z.object({
  b: z.boolean(),
});
export type IsModelOutput = z.infer<typeof IsModelOutputSchema>;

export async function isModel(
  ctx: CallContext,
  input: IsModelInput,
): Promise<IsModelOutput> {
  const raw = await ctx.call(`isModel(${input.typeName})`);
  return parseOutput(
    IsModelOutputSchema,
    { b: expectBool(parse(raw)) },
    "isModel",
  );
}
