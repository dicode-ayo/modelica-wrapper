/**
 * OMC: `function setInstallationDirectoryPath`
 *
 * Sets the `OPENMODELICAHOME` directory for the rest of the session.
 *
 * ```modelica
 * function setInstallationDirectoryPath
 *   input String installationDirectoryPath;
 *   output Boolean success;
 * end setInstallationDirectoryPath;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetInstallationDirectoryPathInputSchema = z.strictObject({
  installationDirectoryPath: z
    .string()
    .describe("Directory to use as OPENMODELICAHOME."),
});
export type SetInstallationDirectoryPathInput = z.input<
  typeof SetInstallationDirectoryPathInputSchema
>;

export const SetInstallationDirectoryPathOutputSchema = SuccessOutput;
export type SetInstallationDirectoryPathOutput = z.infer<
  typeof SetInstallationDirectoryPathOutputSchema
>;

export const SetInstallationDirectoryPathDescription =
  "Set the OpenModelica installation directory (OPENMODELICAHOME).";

export async function setInstallationDirectoryPath(
  ctx: CallContext,
  input: SetInstallationDirectoryPathInput,
): Promise<SetInstallationDirectoryPathOutput> {
  const raw = await ctx.call(
    `setInstallationDirectoryPath(${quote(input.installationDirectoryPath)})`,
  );
  return parseOutput(
    SetInstallationDirectoryPathOutputSchema,
    { success: expectBool(parse(raw)) },
    "setInstallationDirectoryPath",
  );
}
