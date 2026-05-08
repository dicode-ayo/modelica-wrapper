/**
 * OMC: `function setElementModifierValue`
 *
 * ```modelica
 * function setElementModifierValue
 *   input TypeName className;
 *   input TypeName elementName;
 *   input ExpressionOrModification modifier;
 *   output Boolean success;
 * end setElementModifierValue;
 * ```
 *
 * The user-supplied `expr` is wrapped in `$Code(=expr)` to bypass OMC's
 * string-escaping of the expression. Empty `expr` removes the modifier.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { expr } from "../../_shared/fields.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetElementModifierValueInputSchema = z.object({
  typeName: z.string().describe("Class containing the element."),
  elementName: z.string().describe("Dotted element path within the class (OMC `elementName`, emitted bare)."),
  expr: expr.describe(
    "Modelica expression to bind to the modifier; empty clears the modifier.",
  ),
});
export type SetElementModifierValueInput = z.input<
  typeof SetElementModifierValueInputSchema
>;

export const SetElementModifierValueOutputSchema = SuccessOutput;
export type SetElementModifierValueOutput = z.infer<
  typeof SetElementModifierValueOutputSchema
>;

export const SetElementModifierValueDescription =
  "Set or clear a modifier on an element of a class. The user-supplied `expr` is wrapped in `$Code(=expr)` to bypass OMC's string-escaping; an empty `expr` removes the modifier.";

export async function setElementModifierValue(
  ctx: CallContext,
  input: SetElementModifierValueInput,
): Promise<SetElementModifierValueOutput> {
  const codeArg = input.expr === "" ? "$Code(=)" : `$Code(=${input.expr})`;
  const raw = await ctx.call(
    `setElementModifierValue(${input.typeName}, ${input.elementName}, ${codeArg})`,
  );
  return parseOutput(
    SetElementModifierValueOutputSchema,
    { success: expectBool(parse(raw)) },
    "setElementModifierValue",
  );
}
