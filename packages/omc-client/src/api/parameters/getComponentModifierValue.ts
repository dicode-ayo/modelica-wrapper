/**
 * OMC: `function getComponentModifierValue`
 *
 * Returns the value of a single modifier (dotted path, e.g. `k`, `k.value`).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndModifierInput } from "../../_shared/inputs.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetComponentModifierValueInputSchema = TypeNameAndModifierInput;
export type GetComponentModifierValueInput = z.input<
  typeof GetComponentModifierValueInputSchema
>;

export const GetComponentModifierValueOutputSchema = StringValueOutput;
export type GetComponentModifierValueOutput = z.infer<
  typeof GetComponentModifierValueOutputSchema
>;

export const GetComponentModifierValueDescription = "Return the binding value (without sub-modifiers) of a single component modifier.";

export async function getComponentModifierValue(
  ctx: CallContext,
  input: GetComponentModifierValueInput,
): Promise<GetComponentModifierValueOutput> {
  const raw = await ctx.call(
    `getComponentModifierValue(${input.typeName}, ${input.modifier})`,
  );
  const v = parse(raw);
  return parseOutput(
    GetComponentModifierValueOutputSchema,
    { value: asString(v) ?? "" },
    "getComponentModifierValue",
  );
}
