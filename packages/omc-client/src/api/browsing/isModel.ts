/**
 * OMC: `function isModel`
 *
 * Checks whether the given class has the `model` restriction.
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
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsModelInputSchema = TypeNameInput;
export type IsModelInput = z.input<typeof IsModelInputSchema>;

export const IsModelOutputSchema = BooleanBOutput;
export type IsModelOutput = z.infer<typeof IsModelOutputSchema>;

export const IsModelDescription = "Check whether the given class has the `model` restriction.";

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
