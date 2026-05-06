/**
 * OMC: `function setComponentDimensions`
 *
 * Set the array dimensions of a component. `dimensions` are raw Modelica
 * dimension expressions (e.g. "3", ":", "n+1").
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quoteList } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetComponentDimensionsInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
  dimensions: z.array(z.string()),
});
export type SetComponentDimensionsInput = z.input<
  typeof SetComponentDimensionsInputSchema
>;

export const SetComponentDimensionsOutputSchema = z.object({
  success: z.boolean(),
});
export type SetComponentDimensionsOutput = z.infer<
  typeof SetComponentDimensionsOutputSchema
>;

export async function setComponentDimensions(
  ctx: CallContext,
  input: SetComponentDimensionsInput,
): Promise<SetComponentDimensionsOutput> {
  const raw = await ctx.call(
    `setComponentDimensions(${input.typeName}, ${input.componentName}, ${quoteList(input.dimensions)})`,
  );
  return parseOutput(
    SetComponentDimensionsOutputSchema,
    { success: expectBool(parse(raw)) },
    "setComponentDimensions",
  );
}
