/**
 * OMC: `function isRedeclare`
 *
 * Checks whether the given element is a redeclare element.
 *
 * ```modelica
 * function isRedeclare
 *   input TypeName element;
 *   output Boolean b;
 * end isRedeclare;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsRedeclareInputSchema = TypeNameInput;
export type IsRedeclareInput = z.input<typeof IsRedeclareInputSchema>;

export const IsRedeclareOutputSchema = BooleanBOutput;
export type IsRedeclareOutput = z.infer<typeof IsRedeclareOutputSchema>;

export const IsRedeclareDescription =
  "Check whether the given element is a redeclare element.";

export async function isRedeclare(
  ctx: CallContext,
  input: IsRedeclareInput,
): Promise<IsRedeclareOutput> {
  const raw = await ctx.call(`isRedeclare(${input.typeName})`);
  return parseOutput(
    IsRedeclareOutputSchema,
    { b: expectBool(parse(raw)) },
    "isRedeclare",
  );
}
