/**
 * OMC: `function getElementModifierValue`
 *
 * Returns the bound expression of a single modifier on an element of a class.
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
import { TypeNameAndModifierInput } from "../../_shared/inputs.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetElementModifierValueInputSchema = TypeNameAndModifierInput;
export type GetElementModifierValueInput = z.input<
  typeof GetElementModifierValueInputSchema
>;

export const GetElementModifierValueOutputSchema = StringValueOutput;
export type GetElementModifierValueOutput = z.infer<
  typeof GetElementModifierValueOutputSchema
>;

export const GetElementModifierValueDescription =
  "Return the bound expression of a single modifier on an element of a class.";

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
