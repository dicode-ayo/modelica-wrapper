/**
 * OMC: `function getLanguageStandard`
 *
 * Returns the Modelica language version OMC parses and instantiates against
 * (e.g. `"3.6"`).
 *
 * ```modelica
 * function getLanguageStandard
 *   output String outVersion;
 * end getLanguageStandard;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetLanguageStandardOutputSchema = z.object({
  outVersion: z
    .string()
    .describe('Modelica language version in effect (e.g. "3.6").'),
});
export type GetLanguageStandardOutput = z.infer<
  typeof GetLanguageStandardOutputSchema
>;

export const GetLanguageStandardDescription =
  "Return the Modelica language standard version OMC is using.";

export async function getLanguageStandard(
  ctx: CallContext,
): Promise<GetLanguageStandardOutput> {
  const raw = await ctx.call("getLanguageStandard()");
  return parseOutput(
    GetLanguageStandardOutputSchema,
    { outVersion: expectString(parse(raw)) },
    "getLanguageStandard",
  );
}
