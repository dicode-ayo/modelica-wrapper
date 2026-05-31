/**
 * OMC: `function cd`
 *
 * Get or change OMC's working directory.
 *
 * OMC scripting signature:
 *   function cd
 *     input String newWorkingDirectory := "";
 *     output String workingDirectory;
 *   end cd;
 *
 * Behaviour:
 *   - With the empty string (the default), `cd` is a pure getter — it
 *     returns OMC's current working directory without changing it.
 *   - With a non-empty valid path, OMC changes its cwd and returns the
 *     new working directory. OMC may normalize the returned path
 *     (resolved / absolutised), so callers should rely on the returned
 *     value rather than re-using the input string.
 *   - OMC does NOT throw on invalid paths in its scripting API. Observed
 *     OMC 1.26.7 behaviour: on a bad path the `workingDirectory` output
 *     is populated with an in-band error message of the form
 *       "Error, directory <path> does not exist,"
 *     while OMC's cwd is left unchanged. Earlier OMC builds may return
 *     an empty string instead. Callers that need a "did the cd succeed?"
 *     signal should issue a follow-up `cd({})` to read the post-call cwd
 *     and compare it to the requested path (or to a pre-call snapshot).
 *
 * OMC scripting reference:
 *   https://build.openmodelica.org/Documentation/OpenModelica.Scripting.cd.html
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const CdInputSchema = z.object({
  newWorkingDirectory: z
    .string()
    .optional()
    .default("")
    .describe(
      "New working directory. Empty string (default) just returns the current cwd without changing it.",
    ),
});
export type CdInput = z.input<typeof CdInputSchema>;

export const CdOutputSchema = z.object({
  workingDirectory: z
    .string()
    .describe(
      "Current working directory after the call (the new cwd if a path was provided, otherwise unchanged).",
    ),
});
export type CdOutput = z.infer<typeof CdOutputSchema>;

export const CdDescription =
  "Get or change OMC's working directory. With an empty string (default) returns the current cwd; with a path, changes cwd and returns the new (possibly normalized) path.";

export async function cd(ctx: CallContext, input: CdInput): Promise<CdOutput> {
  const newWorkingDirectory = input.newWorkingDirectory ?? "";
  const raw = await ctx.call(`cd(${quote(newWorkingDirectory)})`);
  return parseOutput(
    CdOutputSchema,
    { workingDirectory: expectString(parse(raw)) },
    "cd",
  );
}
