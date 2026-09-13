/**
 * OMC: `function isOptimization`
 *
 * Checks whether the given class is an optimization.
 *
 * ```modelica
 * function isOptimization
 *   input TypeName cl;
 *   output Boolean b;
 * end isOptimization;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsOptimizationInputSchema = TypeNameInput;
export type IsOptimizationInput = z.input<typeof IsOptimizationInputSchema>;

export const IsOptimizationOutputSchema = BooleanBOutput;
export type IsOptimizationOutput = z.infer<typeof IsOptimizationOutputSchema>;

export const IsOptimizationDescription =
  "Check whether the given class is an optimization.";

export async function isOptimization(
  ctx: CallContext,
  input: IsOptimizationInput,
): Promise<IsOptimizationOutput> {
  const raw = await ctx.call(`isOptimization(${input.typeName})`);
  return parseOutput(
    IsOptimizationOutputSchema,
    { b: expectBool(parse(raw)) },
    "isOptimization",
  );
}
