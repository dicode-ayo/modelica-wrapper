/**
 * OMC: `function getComponentModifierNames`
 *
 * Returns the modifier names attached to `component` of `cl`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetComponentModifierNamesInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
});
export type GetComponentModifierNamesInput = z.input<
  typeof GetComponentModifierNamesInputSchema
>;

export const GetComponentModifierNamesOutputSchema = z.object({
  modifiers: z.array(z.string()),
});
export type GetComponentModifierNamesOutput = z.infer<
  typeof GetComponentModifierNamesOutputSchema
>;

export async function getComponentModifierNames(
  ctx: CallContext,
  input: GetComponentModifierNamesInput,
): Promise<GetComponentModifierNamesOutput> {
  const raw = await ctx.call(
    `getComponentModifierNames(${input.typeName}, ${input.componentName})`,
  );
  return parseOutput(
    GetComponentModifierNamesOutputSchema,
    { modifiers: expectStringList(parse(raw)) },
    "getComponentModifierNames",
  );
}
