/**
 * OMC: `function getComponentModifierValue`
 *
 * Returns the value of a single modifier (dotted path, e.g. `k`, `k.value`).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetComponentModifierValueInputSchema = z.object({
  typeName: z.string(),
  modifier: z.string(),
});
export type GetComponentModifierValueInput = z.input<
  typeof GetComponentModifierValueInputSchema
>;

export const GetComponentModifierValueOutputSchema = z.object({
  value: z.string(),
});
export type GetComponentModifierValueOutput = z.infer<
  typeof GetComponentModifierValueOutputSchema
>;

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
