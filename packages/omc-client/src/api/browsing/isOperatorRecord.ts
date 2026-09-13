/**
 * OMC: `function isOperatorRecord`
 *
 * Checks whether the given class is an operator record.
 *
 * ```modelica
 * function isOperatorRecord
 *   input TypeName cl;
 *   output Boolean b;
 * end isOperatorRecord;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsOperatorRecordInputSchema = TypeNameInput;
export type IsOperatorRecordInput = z.input<typeof IsOperatorRecordInputSchema>;

export const IsOperatorRecordOutputSchema = BooleanBOutput;
export type IsOperatorRecordOutput = z.infer<
  typeof IsOperatorRecordOutputSchema
>;

export const IsOperatorRecordDescription =
  "Check whether the given class is an operator record.";

export async function isOperatorRecord(
  ctx: CallContext,
  input: IsOperatorRecordInput,
): Promise<IsOperatorRecordOutput> {
  const raw = await ctx.call(`isOperatorRecord(${input.typeName})`);
  return parseOutput(
    IsOperatorRecordOutputSchema,
    { b: expectBool(parse(raw)) },
    "isOperatorRecord",
  );
}
