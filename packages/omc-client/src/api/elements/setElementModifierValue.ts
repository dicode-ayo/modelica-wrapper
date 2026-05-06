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
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetElementModifierValueInputSchema = z.object({
  typeName: z.string(),
  elementName: z.string(),
  expr: z.string(),
});
export type SetElementModifierValueInput = z.input<
  typeof SetElementModifierValueInputSchema
>;

export const SetElementModifierValueOutputSchema = z.object({
  success: z.boolean(),
});
export type SetElementModifierValueOutput = z.infer<
  typeof SetElementModifierValueOutputSchema
>;

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
