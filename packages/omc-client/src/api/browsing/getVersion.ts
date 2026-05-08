/**
 * OMC: `function getVersion`
 *
 * Returns the version of the OpenModelica compiler when called without an
 * argument, or the version of a loaded Modelica library when its TypeName is
 * passed.
 *
 * ```modelica
 * function getVersion
 *   input TypeName cl = $Code(OpenModelica);
 *   output String version;
 * end getVersion;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { OptionalTypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";
import type { OmcCommand } from "../../commands.js";

export const GetVersionInputSchema = OptionalTypeNameInput;
export type GetVersionInput = z.input<typeof GetVersionInputSchema>;

export const GetVersionOutputSchema = z.object({
  version: z.string().describe('Version string, e.g. "OpenModelica 1.26.7" for the compiler or "4.1.0" for a library.'),
});
export type GetVersionOutput = z.infer<typeof GetVersionOutputSchema>;

export const GetVersionDescription =
  "Return the version of the OpenModelica compiler, or the version of a loaded Modelica library when its TypeName is supplied.";

export async function getVersion(
  ctx: CallContext,
  input: GetVersionInput = {},
): Promise<GetVersionOutput> {
  const cmd: OmcCommand =
    input.typeName === undefined
      ? "getVersion()"
      : `getVersion(${input.typeName})`;
  const raw = await ctx.call(cmd);
  return parseOutput(
    GetVersionOutputSchema,
    { version: expectString(parse(raw)) },
    "getVersion",
  );
}
