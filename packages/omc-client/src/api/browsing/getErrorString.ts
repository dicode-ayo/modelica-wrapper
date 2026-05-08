/**
 * OMC: `function getErrorString`
 *
 * Returns the user-readable text of any errors stored by the most recent OMC
 * call, optionally treating warnings as errors.
 *
 * ```modelica
 * function getErrorString
 *   input Boolean warningsAsErrors = false;
 *   output String errorString;
 * end getErrorString;
 * ```
 *
 * Many OMC mutations return `false` and stash the diagnostic here. Always
 * call this after a benign-looking falsy response before treating the
 * operation as a no-op.
 */

import { z } from "zod";

import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";
import type { OmcCommand } from "../../commands.js";

export const GetErrorStringInputSchema = z.object({
  warningsAsErrors: z.boolean().optional().default(false).describe("Treat OMC warnings as errors when assembling the diagnostic text."),
});
export type GetErrorStringInput = z.input<typeof GetErrorStringInputSchema>;

export const GetErrorStringOutputSchema = z.object({
  errorString: z.string().describe("User-readable text of any errors stored by the most recent OMC call; empty when none."),
});
export type GetErrorStringOutput = z.infer<typeof GetErrorStringOutputSchema>;

/**
 * Lower-level "transport" callable so we don't recurse through CallContext
 * (which itself uses getErrorString for failure handling).
 */
export interface ErrorStringCaller {
  call(cmd: OmcCommand): Promise<string>;
}

export const GetErrorStringDescription =
  "Return the user-readable text of any errors stored by the most recent OMC call (optionally treating warnings as errors).";

export async function getErrorString(
  caller: ErrorStringCaller,
  input: GetErrorStringInput = {},
): Promise<GetErrorStringOutput> {
  const cmd: OmcCommand = `getErrorString(warningsAsErrors=${mlBool(input.warningsAsErrors ?? false)})`;
  const raw = await caller.call(cmd);
  return parseOutput(
    GetErrorStringOutputSchema,
    { errorString: expectString(parse(raw)) },
    "getErrorString",
  );
}
