/**
 * OMC: `function getElementModifierValues`
 *
 * ```modelica
 * function getElementModifierValues
 *   input TypeName className;
 *   input TypeName modifier;
 *   output String value;
 * end getElementModifierValues;
 * ```
 *
 * Like `getElementModifierValue` but returns the full bound expression including
 * sub-modifications. `modifier` is a dotted path TypeName; emitted bare.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetElementModifierValuesInputSchema = z.object({
  typeName: z.string(),
  modifier: z.string(),
});
export type GetElementModifierValuesInput = z.input<
  typeof GetElementModifierValuesInputSchema
>;

export const GetElementModifierValuesOutputSchema = z.object({
  value: z.string(),
});
export type GetElementModifierValuesOutput = z.infer<
  typeof GetElementModifierValuesOutputSchema
>;

export async function getElementModifierValues(
  ctx: CallContext,
  input: GetElementModifierValuesInput,
): Promise<GetElementModifierValuesOutput> {
  const raw = await ctx.call(
    `getElementModifierValues(${input.typeName}, ${input.modifier})`,
  );
  return parseOutput(
    GetElementModifierValuesOutputSchema,
    { value: asString(parse(raw)) ?? "" },
    "getElementModifierValues",
  );
}
