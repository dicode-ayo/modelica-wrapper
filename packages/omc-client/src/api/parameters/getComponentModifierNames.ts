/**
 * OMC: `function getComponentModifierNames`
 *
 * Returns the modifier names attached to `component` of `cl`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetComponentModifierNamesInputSchema = TypeNameAndComponentNameInput;
export type GetComponentModifierNamesInput = z.input<
  typeof GetComponentModifierNamesInputSchema
>;

export const GetComponentModifierNamesOutputSchema = z.object({
  modifiers: z.array(z.string()).describe("Modifier names declared on the component."),
});
export type GetComponentModifierNamesOutput = z.infer<
  typeof GetComponentModifierNamesOutputSchema
>;

export const GetComponentModifierNamesDescription = "List the modifier names declared on a component of a class.";

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
