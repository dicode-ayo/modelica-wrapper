/**
 * OMC: `function isType`
 *
 * Checks whether the given class has the `type` restriction.
 *
 * ```modelica
 * function isType
 *   input TypeName cl;
 *   output Boolean b;
 * end isType;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsTypeInputSchema = TypeNameInput;
export type IsTypeInput = z.input<typeof IsTypeInputSchema>;

export const IsTypeOutputSchema = BooleanBOutput;
export type IsTypeOutput = z.infer<typeof IsTypeOutputSchema>;

export const IsTypeDescription =
  "Check whether the given class has the `type` restriction.";

export async function isType(
  ctx: CallContext,
  input: IsTypeInput,
): Promise<IsTypeOutput> {
  const raw = await ctx.call(`isType(${input.typeName})`);
  return parseOutput(
    IsTypeOutputSchema,
    { b: expectBool(parse(raw)) },
    "isType",
  );
}
