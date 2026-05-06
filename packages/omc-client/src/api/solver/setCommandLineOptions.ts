/**
 * OMC: `function setCommandLineOptions`
 *
 * ```modelica
 * function setCommandLineOptions
 *   input String options;
 *   output Boolean success;
 * end setCommandLineOptions;
 * ```
 *
 * Pass raw OMC compiler flags as a single string, e.g.
 * "-d=initialization,nls --solverMethod=dassl".
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetCommandLineOptionsInputSchema = z.object({
  options: z.string(),
});
export type SetCommandLineOptionsInput = z.input<
  typeof SetCommandLineOptionsInputSchema
>;

export const SetCommandLineOptionsOutputSchema = z.object({
  success: z.boolean(),
});
export type SetCommandLineOptionsOutput = z.infer<
  typeof SetCommandLineOptionsOutputSchema
>;

export async function setCommandLineOptions(
  ctx: CallContext,
  input: SetCommandLineOptionsInput,
): Promise<SetCommandLineOptionsOutput> {
  const raw = await ctx.call(`setCommandLineOptions(${quote(input.options)})`);
  return parseOutput(
    SetCommandLineOptionsOutputSchema,
    { success: expectBool(parse(raw)) },
    "setCommandLineOptions",
  );
}
