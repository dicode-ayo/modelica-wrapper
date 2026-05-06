/**
 * OMC: `function getElementModifierNames`
 *
 * ```modelica
 * function getElementModifierNames
 *   input TypeName className;
 *   input String elementName;
 *   output String[:] modifiers;
 * end getElementModifierNames;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetElementModifierNamesInputSchema = z.object({
  typeName: z.string(),
  elementName: z.string(),
});
export type GetElementModifierNamesInput = z.input<
  typeof GetElementModifierNamesInputSchema
>;

export const GetElementModifierNamesOutputSchema = z.object({
  modifiers: z.array(z.string()),
});
export type GetElementModifierNamesOutput = z.infer<
  typeof GetElementModifierNamesOutputSchema
>;

export async function getElementModifierNames(
  ctx: CallContext,
  input: GetElementModifierNamesInput,
): Promise<GetElementModifierNamesOutput> {
  const raw = await ctx.call(
    `getElementModifierNames(${input.typeName}, ${quote(input.elementName)})`,
  );
  return parseOutput(
    GetElementModifierNamesOutputSchema,
    { modifiers: expectStringList(parse(raw)) },
    "getElementModifierNames",
  );
}
