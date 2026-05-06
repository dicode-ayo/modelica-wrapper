/**
 * OMC: `function getVersion`
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
  version: z.string(),
});
export type GetVersionOutput = z.infer<typeof GetVersionOutputSchema>;

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
