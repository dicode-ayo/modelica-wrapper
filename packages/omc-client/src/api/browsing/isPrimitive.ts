/**
 * OMC: `function isPrimitive`
 *
 * Checks whether the given type is a primitive (built-in) type.
 *
 * ```modelica
 * function isPrimitive
 *   input TypeName className;
 *   output Boolean result;
 * end isPrimitive;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanResultOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsPrimitiveInputSchema = TypeNameInput;
export type IsPrimitiveInput = z.input<typeof IsPrimitiveInputSchema>;

export const IsPrimitiveOutputSchema = BooleanResultOutput;
export type IsPrimitiveOutput = z.infer<typeof IsPrimitiveOutputSchema>;

export const IsPrimitiveDescription =
  "Check whether the given type is a primitive (built-in) type.";

export async function isPrimitive(
  ctx: CallContext,
  input: IsPrimitiveInput,
): Promise<IsPrimitiveOutput> {
  const raw = await ctx.call(`isPrimitive(${input.typeName})`);
  return parseOutput(
    IsPrimitiveOutputSchema,
    { result: expectBool(parse(raw)) },
    "isPrimitive",
  );
}
