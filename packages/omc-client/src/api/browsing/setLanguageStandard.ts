/**
 * OMC: `function setLanguageStandard`
 *
 * Sets the Modelica language version OMC parses and instantiates against for
 * the rest of the session.
 *
 * ```modelica
 * function setLanguageStandard
 *   input String inVersion;
 *   output Boolean success;
 * end setLanguageStandard;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetLanguageStandardInputSchema = z.strictObject({
  inVersion: z
    .string()
    .describe('Modelica language version to use (e.g. "3.5").'),
});
export type SetLanguageStandardInput = z.input<
  typeof SetLanguageStandardInputSchema
>;

export const SetLanguageStandardOutputSchema = SuccessOutput;
export type SetLanguageStandardOutput = z.infer<
  typeof SetLanguageStandardOutputSchema
>;

export const SetLanguageStandardDescription =
  "Set the Modelica language standard version OMC uses.";

export async function setLanguageStandard(
  ctx: CallContext,
  input: SetLanguageStandardInput,
): Promise<SetLanguageStandardOutput> {
  const raw = await ctx.call(`setLanguageStandard(${quote(input.inVersion)})`);
  return parseOutput(
    SetLanguageStandardOutputSchema,
    { success: expectBool(parse(raw)) },
    "setLanguageStandard",
  );
}
