/**
 * OMC: `function setModelicaPath`
 *
 * Replaces the library search path. OMC stores it as the
 * `OPENMODELICALIBRARY` environment variable (the `MODELICAPATH` variable
 * itself is ignored), so a later `getEnvironmentVar("OPENMODELICALIBRARY")`
 * reflects it.
 *
 * ```modelica
 * function setModelicaPath
 *   input String modelicaPath;
 *   output Boolean success;
 * end setModelicaPath;
 * ```
 *
 * The value replaces the installed default rather than extending it: a path
 * that omits the system library directory makes `Modelica` unloadable. Entries
 * are split on the platform's own separator only (`:` on POSIX, `;` on
 * Windows), and when two entries hold the same library the **last** one wins.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetModelicaPathInputSchema = z.strictObject({
  modelicaPath: z
    .string()
    .describe(
      "Directories OMC searches for libraries, joined with the platform path separator. Replaces the installed default.",
    ),
});
export type SetModelicaPathInput = z.input<typeof SetModelicaPathInputSchema>;

export const SetModelicaPathOutputSchema = SuccessOutput;
export type SetModelicaPathOutput = z.infer<typeof SetModelicaPathOutputSchema>;

export const SetModelicaPathDescription =
  "Replace the MODELICAPATH — the directories OMC searches for libraries.";

export async function setModelicaPath(
  ctx: CallContext,
  input: SetModelicaPathInput,
): Promise<SetModelicaPathOutput> {
  const raw = await ctx.call(`setModelicaPath(${quote(input.modelicaPath)})`);
  return parseOutput(
    SetModelicaPathOutputSchema,
    { success: expectBool(parse(raw)) },
    "setModelicaPath",
  );
}
