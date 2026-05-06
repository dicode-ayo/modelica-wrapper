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
  fileName: z.string(),
  readParameters: z.boolean().optional().default(true),
  openmodelicaStyle: z.boolean().optional().default(false),
});
export type ReadSimulationResultVarsInput = z.input<
  typeof ReadSimulationResultVarsInputSchema
>;

export const ReadSimulationResultVarsOutputSchema = z.object({
  vars: z.array(z.string()),
});
export type ReadSimulationResultVarsOutput = z.infer<
  typeof ReadSimulationResultVarsOutputSchema
>;

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
