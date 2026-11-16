/**
 * OMC: `function getTempDirectoryPath`
 *
 * Returns the directory OMC writes its temporary files to (e.g. `"/tmp"`).
 *
 * ```modelica
 * function getTempDirectoryPath
 *   output String tempDirectoryPath;
 * end getTempDirectoryPath;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetTempDirectoryPathOutputSchema = z.object({
  tempDirectoryPath: z
    .string()
    .describe("Directory OMC writes its temporary files to."),
});
export type GetTempDirectoryPathOutput = z.infer<
  typeof GetTempDirectoryPathOutputSchema
>;

export const GetTempDirectoryPathDescription =
  "Return the directory OMC writes its temporary files to.";

export async function getTempDirectoryPath(
  ctx: CallContext,
): Promise<GetTempDirectoryPathOutput> {
  const raw = await ctx.call("getTempDirectoryPath()");
  return parseOutput(
    GetTempDirectoryPathOutputSchema,
    { tempDirectoryPath: expectString(parse(raw)) },
    "getTempDirectoryPath",
  );
}
