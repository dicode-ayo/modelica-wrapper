/**
 * OMC: `function isExperiment`
 *
 * Reports whether the class has an `experiment(...)` annotation.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsExperimentInputSchema = TypeNameInput;
export type IsExperimentInput = z.input<typeof IsExperimentInputSchema>;

export const IsExperimentOutputSchema = z.object({
  isExperiment: z.boolean(),
});
export type IsExperimentOutput = z.infer<typeof IsExperimentOutputSchema>;

export async function isExperiment(
  ctx: CallContext,
  input: IsExperimentInput,
): Promise<IsExperimentOutput> {
  const raw = await ctx.call(`isExperiment(${input.typeName})`);
  return parseOutput(
    IsExperimentOutputSchema,
    { isExperiment: expectBool(parse(raw)) },
    "isExperiment",
  );
}
