/**
 * OMC: `function isOperatorFunction`
 *
 * Checks whether the given class is an operator function.
 *
 * ```modelica
 * function isOperatorFunction
 *   input TypeName cl;
 *   output Boolean b;
 * end isOperatorFunction;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsOperatorFunctionInputSchema = TypeNameInput;
export type IsOperatorFunctionInput = z.input<
  typeof IsOperatorFunctionInputSchema
>;

export const IsOperatorFunctionOutputSchema = BooleanBOutput;
export type IsOperatorFunctionOutput = z.infer<
  typeof IsOperatorFunctionOutputSchema
>;

export const IsOperatorFunctionDescription =
  "Check whether the given class is an operator function.";

export async function isOperatorFunction(
  ctx: CallContext,
  input: IsOperatorFunctionInput,
): Promise<IsOperatorFunctionOutput> {
  const raw = await ctx.call(`isOperatorFunction(${input.typeName})`);
  return parseOutput(
    IsOperatorFunctionOutputSchema,
    { b: expectBool(parse(raw)) },
    "isOperatorFunction",
  );
}
