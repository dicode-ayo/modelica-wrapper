/**
 * OMC: `function getEnvironmentVar`
 *
 * Returns the value of an environment variable in OMC's own process —
 * including what `setEnvironmentVar` and `setModelicaPath` changed since it
 * started. An unset variable reads as `""`.
 *
 * ```modelica
 * function getEnvironmentVar
 *   input String var;
 *   output String value;
 * end getEnvironmentVar;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetEnvironmentVarInputSchema = z.strictObject({
  var: z
    .string()
    .describe('Environment variable name (e.g. "OPENMODELICALIBRARY").'),
});
export type GetEnvironmentVarInput = z.input<
  typeof GetEnvironmentVarInputSchema
>;

export const GetEnvironmentVarOutputSchema = z.object({
  value: z
    .string()
    .describe("The variable's value in OMC's process; empty when unset."),
});
export type GetEnvironmentVarOutput = z.infer<
  typeof GetEnvironmentVarOutputSchema
>;

export const GetEnvironmentVarDescription =
  "Return the value of an environment variable in OMC's process.";

export async function getEnvironmentVar(
  ctx: CallContext,
  input: GetEnvironmentVarInput,
): Promise<GetEnvironmentVarOutput> {
  const raw = await ctx.call(`getEnvironmentVar(${quote(input.var)})`);
  return parseOutput(
    GetEnvironmentVarOutputSchema,
    { value: expectString(parse(raw)) },
    "getEnvironmentVar",
  );
}
