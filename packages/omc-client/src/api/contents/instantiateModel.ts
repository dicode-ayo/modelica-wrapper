/**
 * OMC: `function instantiateModel`
 *
 * Returns the flattened Modelica source after frontend elaboration —
 * post-extends, post-modifier-application. This is what the backend solver
 * sees, and what's useful for diff-based debugging or external tools.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const InstantiateModelInputSchema = TypeNameInput;
export type InstantiateModelInput = z.input<typeof InstantiateModelInputSchema>;

export const InstantiateModelOutputSchema = z.object({
  flatSource: z
    .string()
    .describe(
      "Flattened Modelica source after frontend elaboration; what the backend solver consumes.",
    ),
});
export type InstantiateModelOutput = z.infer<
  typeof InstantiateModelOutputSchema
>;

export const InstantiateModelDescription =
  "Instantiate a model and return the flattened Modelica source.";

export async function instantiateModel(
  ctx: CallContext,
  input: InstantiateModelInput,
): Promise<InstantiateModelOutput> {
  const raw = await ctx.call(`instantiateModel(${input.typeName})`);
  return parseOutput(
    InstantiateModelOutputSchema,
    { flatSource: expectString(parse(raw)) },
    "instantiateModel",
  );
}
