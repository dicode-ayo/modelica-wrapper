/**
 * OMC: `function getModelicaPath`
 *
 * Returns the MODELICAPATH: the platform-separated list of directories OMC
 * searches for libraries (system libraries live here — e.g.
 * `~/.openmodelica/libraries/`).
 *
 * ```modelica
 * function getModelicaPath
 *   output String modelicaPath;
 * end getModelicaPath;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetModelicaPathOutputSchema = z.object({
  modelicaPath: z
    .string()
    .describe(
      "Platform-separated list of directories OMC searches for libraries.",
    ),
});
export type GetModelicaPathOutput = z.infer<typeof GetModelicaPathOutputSchema>;

export const GetModelicaPathDescription =
  "Return the MODELICAPATH — the directories OMC searches for libraries.";

export async function getModelicaPath(
  ctx: CallContext,
): Promise<GetModelicaPathOutput> {
  const raw = await ctx.call("getModelicaPath()");
  return parseOutput(
    GetModelicaPathOutputSchema,
    { modelicaPath: expectString(parse(raw)) },
    "getModelicaPath",
  );
}
