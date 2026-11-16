/**
 * OMC: `function setTempDirectoryPath`
 *
 * Sets the directory OMC writes its temporary files to for the rest of the
 * session.
 *
 * ```modelica
 * function setTempDirectoryPath
 *   input String tempDirectoryPath;
 *   output Boolean success;
 * end setTempDirectoryPath;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetTempDirectoryPathInputSchema = z.strictObject({
  tempDirectoryPath: z
    .string()
    .describe("Directory OMC should write its temporary files to."),
});
export type SetTempDirectoryPathInput = z.input<
  typeof SetTempDirectoryPathInputSchema
>;

export const SetTempDirectoryPathOutputSchema = SuccessOutput;
export type SetTempDirectoryPathOutput = z.infer<
  typeof SetTempDirectoryPathOutputSchema
>;

export const SetTempDirectoryPathDescription =
  "Set the directory OMC writes its temporary files to.";

export async function setTempDirectoryPath(
  ctx: CallContext,
  input: SetTempDirectoryPathInput,
): Promise<SetTempDirectoryPathOutput> {
  const raw = await ctx.call(
    `setTempDirectoryPath(${quote(input.tempDirectoryPath)})`,
  );
  return parseOutput(
    SetTempDirectoryPathOutputSchema,
    { success: expectBool(parse(raw)) },
    "setTempDirectoryPath",
  );
}
