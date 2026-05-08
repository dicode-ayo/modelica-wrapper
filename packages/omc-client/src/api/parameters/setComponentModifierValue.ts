/**
 * OMC: `function setComponentModifierValue`
 *
 * Set a modifier on a component. `expr` is the raw Modelica expression for
 * the value (e.g. `1.5`, `true`, `{1, 2, 3}`); empty string removes the
 * modifier. OMC requires the value wrapped in `$Code(=expr)` to bypass
 * string-escaping of the expression.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndModifierInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetComponentModifierValueInputSchema =
  TypeNameAndModifierInput.extend({
    expr: z.string().describe("Raw Modelica expression for the new modifier value (wrapped in `$Code(=…)` for OMC); empty removes the modifier."),
  });
export type SetComponentModifierValueInput = z.input<
  typeof SetComponentModifierValueInputSchema
>;

export const SetComponentModifierValueOutputSchema = SuccessOutput;
export type SetComponentModifierValueOutput = z.infer<
  typeof SetComponentModifierValueOutputSchema
>;

export const SetComponentModifierValueDescription =
  "Set a modifier on a component (OMC: deprecated alias for setElementModifierValue).";

export async function setComponentModifierValue(
  ctx: CallContext,
  input: SetComponentModifierValueInput,
): Promise<SetComponentModifierValueOutput> {
  const codeArg = input.expr === "" ? "$Code(=)" : `$Code(=${input.expr})`;
  const raw = await ctx.call(
    `setComponentModifierValue(${input.typeName}, ${input.modifier}, ${codeArg})`,
  );
  return parseOutput(
    SetComponentModifierValueOutputSchema,
    { success: expectBool(parse(raw)) },
    "setComponentModifierValue",
  );
}
