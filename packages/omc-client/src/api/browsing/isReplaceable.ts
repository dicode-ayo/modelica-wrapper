/**
 * OMC: `function isReplaceable`
 *
 * Checks whether the given element is declared `replaceable`.
 *
 * ```modelica
 * function isReplaceable
 *   input TypeName element;
 *   output Boolean b;
 * end isReplaceable;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsReplaceableInputSchema = TypeNameInput;
export type IsReplaceableInput = z.input<typeof IsReplaceableInputSchema>;

export const IsReplaceableOutputSchema = BooleanBOutput;
export type IsReplaceableOutput = z.infer<typeof IsReplaceableOutputSchema>;

export const IsReplaceableDescription = "Check whether the given element is declared `replaceable`.";

export async function isReplaceable(
  ctx: CallContext,
  input: IsReplaceableInput,
): Promise<IsReplaceableOutput> {
  const raw = await ctx.call(`isReplaceable(${input.typeName})`);
  return parseOutput(
    IsReplaceableOutputSchema,
    { b: expectBool(parse(raw)) },
    "isReplaceable",
  );
}
