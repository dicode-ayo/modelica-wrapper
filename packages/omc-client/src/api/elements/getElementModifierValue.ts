/**
 * OMC: `function getElementModifierValue`
 *
 * ```modelica
 * function getElementModifierValue
 *   input TypeName className;
 *   input TypeName modifier;
 *   output String value;
 * end getElementModifierValue;
 * ```
 *
 * `modifier` is a dotted path TypeName (e.g. `PI.k.value`); emitted bare.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetElementModifierValueInputSchema = z.object({
  typeName: z.string(),
  modifier: z.string(),
});
export type GetElementModifierValueInput = z.input<
  typeof GetElementModifierValueInputSchema
>;

export const GetElementModifierValueOutputSchema = z.object({
  value: z.string(),
});
export type GetElementModifierValueOutput = z.infer<
  typeof GetElementModifierValueOutputSchema
>;

export async function getElementModifierValue(
  ctx: CallContext,
  input: GetElementModifierValueInput,
): Promise<GetElementModifierValueOutput> {
  const raw = await ctx.call(
    `getElementModifierValue(${input.typeName}, ${input.modifier})`,
  );
  return parseOutput(
    GetElementModifierValueOutputSchema,
    { value: asString(parse(raw)) ?? "" },
    "getElementModifierValue",
  );
}
