/**
 * OMC: `function buildModel`
 *
 * Compile the class to a runnable simulator executable. Returns the
 * (executable name, init file) pair OMC reports.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const BuildModelInputSchema = TypeNameInput;
export type BuildModelInput = z.input<typeof BuildModelInputSchema>;

export const BuildModelOutputSchema = z.object({
  /** Two-element string array: [executableName, initFileName]. */
  artifacts: z.array(z.string()),
});
export type BuildModelOutput = z.infer<typeof BuildModelOutputSchema>;

export async function buildModel(
  ctx: CallContext,
  input: BuildModelInput,
): Promise<BuildModelOutput> {
  const raw = await ctx.call(`buildModel(${input.typeName})`);
  return parseOutput(
    BuildModelOutputSchema,
    { artifacts: expectStringList(parse(raw)) },
    "buildModel",
  );
}
