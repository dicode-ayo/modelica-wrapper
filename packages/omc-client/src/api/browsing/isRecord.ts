/**
 * OMC: `function isRecord`
 *
 * Checks whether the given class has the `record` restriction.
 *
 * ```modelica
 * function isRecord
 *   input TypeName cl;
 *   output Boolean b;
 * end isRecord;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsRecordInputSchema = TypeNameInput;
export type IsRecordInput = z.input<typeof IsRecordInputSchema>;

export const IsRecordOutputSchema = BooleanBOutput;
export type IsRecordOutput = z.infer<typeof IsRecordOutputSchema>;

export const IsRecordDescription =
  "Check whether the given class has the `record` restriction.";

export async function isRecord(
  ctx: CallContext,
  input: IsRecordInput,
): Promise<IsRecordOutput> {
  const raw = await ctx.call(`isRecord(${input.typeName})`);
  return parseOutput(
    IsRecordOutputSchema,
    { b: expectBool(parse(raw)) },
    "isRecord",
  );
}
