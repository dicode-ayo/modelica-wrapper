/**
 * OMC: `function setParameterValue`
 *
 * ```modelica
 * function setParameterValue
 *   input TypeName className;
 *   input TypeName variableName;
 *   input Expression value;
 *   output Boolean success;
 * end setParameterValue;
 * ```
 *
 * `variableName` is a dotted path TypeName emitted bare. `value` is the raw
 * Modelica expression (e.g. `1.5`, `{1, 2}`); wrapped in `$Code(=...)` so OMC
 * doesn't string-escape it. Empty `value` clears the binding.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetParameterValueInputSchema = z.object({
  typeName: z.string(),
  variableName: z.string(),
  value: z.string(),
});
export type SetParameterValueInput = z.input<
  typeof SetParameterValueInputSchema
>;

export const SetParameterValueOutputSchema = SuccessOutput;
export type SetParameterValueOutput = z.infer<
  typeof SetParameterValueOutputSchema
>;

export async function setParameterValue(
  ctx: CallContext,
  input: SetParameterValueInput,
): Promise<SetParameterValueOutput> {
  const codeArg = input.value === "" ? "$Code(=)" : `$Code(=${input.value})`;
  const raw = await ctx.call(
    `setParameterValue(${input.typeName}, ${input.variableName}, ${codeArg})`,
  );
  return parseOutput(
    SetParameterValueOutputSchema,
    { success: expectBool(parse(raw)) },
    "setParameterValue",
  );
}
