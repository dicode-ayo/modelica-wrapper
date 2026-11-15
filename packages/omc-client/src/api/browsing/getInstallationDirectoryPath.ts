/**
 * OMC: `function getInstallationDirectoryPath`
 *
 * Returns the `OPENMODELICAHOME` directory OMC resolves its own libraries and
 * runtime against (e.g. `"/usr/bin/.."`).
 *
 * ```modelica
 * function getInstallationDirectoryPath
 *   output String installationDirectoryPath;
 * end getInstallationDirectoryPath;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetInstallationDirectoryPathOutputSchema = z.object({
  installationDirectoryPath: z
    .string()
    .describe("The OPENMODELICAHOME directory of the running OMC."),
});
export type GetInstallationDirectoryPathOutput = z.infer<
  typeof GetInstallationDirectoryPathOutputSchema
>;

export const GetInstallationDirectoryPathDescription =
  "Return the OpenModelica installation directory (OPENMODELICAHOME).";

export async function getInstallationDirectoryPath(
  ctx: CallContext,
): Promise<GetInstallationDirectoryPathOutput> {
  const raw = await ctx.call("getInstallationDirectoryPath()");
  return parseOutput(
    GetInstallationDirectoryPathOutputSchema,
    { installationDirectoryPath: expectString(parse(raw)) },
    "getInstallationDirectoryPath",
  );
}
