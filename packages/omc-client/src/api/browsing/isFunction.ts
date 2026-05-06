/**
 * OMC: `function isFunction`
 *
 * ```modelica
 * function isFunction
 *   input TypeName cl;
 *   output Boolean b;
 * end isFunction;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsFunctionInputSchema = TypeNameInput;
export type IsFunctionInput = z.input<typeof IsFunctionInputSchema>;

export const IsFunctionOutputSchema = z.object({
  b: z.boolean(),
});
export type IsFunctionOutput = z.infer<typeof IsFunctionOutputSchema>;

export async function isFunction(
  ctx: CallContext,
  input: IsFunctionInput,
): Promise<IsFunctionOutput> {
  const raw = await ctx.call(`isFunction(${input.typeName})`);
  return parseOutput(
    IsFunctionOutputSchema,
    { b: expectBool(parse(raw)) },
    "isFunction",
  );
}
