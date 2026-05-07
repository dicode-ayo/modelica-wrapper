/**
 * OMC: `function isClass`
 *
 * ```modelica
 * function isClass
 *   input TypeName cl;
 *   output Boolean b;
 * end isClass;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsClassInputSchema = TypeNameInput;
export type IsClassInput = z.input<typeof IsClassInputSchema>;

export const IsClassOutputSchema = BooleanBOutput;
export type IsClassOutput = z.infer<typeof IsClassOutputSchema>;

export async function isClass(
  ctx: CallContext,
  input: IsClassInput,
): Promise<IsClassOutput> {
  const raw = await ctx.call(`isClass(${input.typeName})`);
  return parseOutput(
    IsClassOutputSchema,
    { b: expectBool(parse(raw)) },
    "isClass",
  );
}
