/**
 * OMC: `function setEnvironmentVar`
 *
 * Sets an environment variable in OMC's own process, which every compiler and
 * simulation subprocess OMC spawns afterwards inherits.
 *
 * ```modelica
 * function setEnvironmentVar
 *   input String var;
 *   input String value;
 *   output Boolean success;
 * end setEnvironmentVar;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetEnvironmentVarInputSchema = z.strictObject({
  var: z.string().describe("Environment variable name."),
  value: z.string().describe("Value to assign."),
});
export type SetEnvironmentVarInput = z.input<
  typeof SetEnvironmentVarInputSchema
>;

export const SetEnvironmentVarOutputSchema = SuccessOutput;
export type SetEnvironmentVarOutput = z.infer<
  typeof SetEnvironmentVarOutputSchema
>;

export const SetEnvironmentVarDescription =
  "Set an environment variable in OMC's process and every subprocess it spawns.";

export async function setEnvironmentVar(
  ctx: CallContext,
  input: SetEnvironmentVarInput,
): Promise<SetEnvironmentVarOutput> {
  const raw = await ctx.call(
    `setEnvironmentVar(${quote(input.var)}, ${quote(input.value)})`,
  );
  return parseOutput(
    SetEnvironmentVarOutputSchema,
    { success: expectBool(parse(raw)) },
    "setEnvironmentVar",
  );
}
