/**
 * OMC: `function getComponentModifierValues`
 *
 * Like getComponentModifierValue but includes any sub-modifiers in the result.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndModifierInput } from "../../_shared/inputs.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetComponentModifierValuesInputSchema = TypeNameAndModifierInput;
export type GetComponentModifierValuesInput = z.input<
  typeof GetComponentModifierValuesInputSchema
>;

export const GetComponentModifierValuesOutputSchema = StringValueOutput;
export type GetComponentModifierValuesOutput = z.infer<
  typeof GetComponentModifierValuesOutputSchema
>;

export const GetComponentModifierValuesDescription = "Return the modifier including sub-modifiers for a component.";

export async function getComponentModifierValues(
  ctx: CallContext,
  input: GetComponentModifierValuesInput,
): Promise<GetComponentModifierValuesOutput> {
  const raw = await ctx.call(
    `getComponentModifierValues(${input.typeName}, ${input.modifier})`,
  );
  const v = parse(raw);
  return parseOutput(
    GetComponentModifierValuesOutputSchema,
    { value: asString(v) ?? "" },
    "getComponentModifierValues",
  );
}
