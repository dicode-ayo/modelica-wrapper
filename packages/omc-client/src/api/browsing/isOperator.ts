/**
 * OMC: `function isOperator`
 *
 * Checks whether the given class is an operator.
 *
 * ```modelica
 * function isOperator
 *   input TypeName cl;
 *   output Boolean b;
 * end isOperator;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsOperatorInputSchema = TypeNameInput;
export type IsOperatorInput = z.input<typeof IsOperatorInputSchema>;

export const IsOperatorOutputSchema = BooleanBOutput;
export type IsOperatorOutput = z.infer<typeof IsOperatorOutputSchema>;

export const IsOperatorDescription =
  "Check whether the given class is an operator.";

export async function isOperator(
  ctx: CallContext,
  input: IsOperatorInput,
): Promise<IsOperatorOutput> {
  const raw = await ctx.call(`isOperator(${input.typeName})`);
  return parseOutput(
    IsOperatorOutputSchema,
    { b: expectBool(parse(raw)) },
    "isOperator",
  );
}
