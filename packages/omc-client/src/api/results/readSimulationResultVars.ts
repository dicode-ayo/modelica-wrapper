/**
 * OMC: `function readSimulationResultVars`
 *
 * Returns the variable names stored in the result file.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const ReadSimulationResultVarsInputSchema = z.object({
  fileName: z.string().describe("Path to the simulation result file to inspect."),
  readParameters: z.boolean().optional().default(true).describe("Include parameter names in the returned list."),
  openmodelicaStyle: z.boolean().optional().default(false).describe("Normalize variable names to OMC's canonical form (e.g. `a.der(b)` → `der(a.b)`)."),
});
export type ReadSimulationResultVarsInput = z.input<
  typeof ReadSimulationResultVarsInputSchema
>;

export const ReadSimulationResultVarsOutputSchema = z.object({
  vars: z.array(z.string()).describe("Variable (and optionally parameter) names stored in the result file."),
});
export type ReadSimulationResultVarsOutput = z.infer<
  typeof ReadSimulationResultVarsOutputSchema
>;

export const ReadSimulationResultVarsDescription =
  "List the variable names stored in a simulation result file (with options to include parameters and to normalize to OMC style).";

export async function readSimulationResultVars(
  ctx: CallContext,
  input: ReadSimulationResultVarsInput,
): Promise<ReadSimulationResultVarsOutput> {
  const raw = await ctx.call(
    `readSimulationResultVars(${quote(input.fileName)}, readParameters=${mlBool(input.readParameters ?? true)}, openmodelicaStyle=${mlBool(input.openmodelicaStyle ?? false)})`,
  );
  return parseOutput(
    ReadSimulationResultVarsOutputSchema,
    { vars: expectStringList(parse(raw)) },
    "readSimulationResultVars",
  );
}
