/**
 * OMC: `function getParameterValue`
 *
 * ```modelica
 * function getParameterValue
 *   input TypeName class_;
 *   input String parameterName;
 *   output String parameterValue;
 * end getParameterValue;
 * ```
 *
 * Returns the literal text of a parameter's value, or "" if unset.
 *
 * NOTE on argument shape: `parameterName` is a Modelica `String`, NOT a
 * TypeName — it must be quoted. Earlier wrapper versions sent it bare,
 * which triggered OMC's misleading "Class getParameterValue not found
 * in scope" diagnostic and made the call silently return "". See
 * `docs/audit.md` §2.10 for the gotcha.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import {
  asBool,
  asFloat,
  asInt,
  asString,
  isNull,
  parse,
} from "../../parse.js";

export const GetParameterValueInputSchema = z.object({
  typeName: z.string().describe("Class containing the parameter."),
  name: z
    .string()
    .describe("Parameter name to read (dotted path for nested parameters)."),
});
export type GetParameterValueInput = z.input<
  typeof GetParameterValueInputSchema
>;

export const GetParameterValueOutputSchema = StringValueOutput;
export type GetParameterValueOutput = z.infer<
  typeof GetParameterValueOutputSchema
>;

export const GetParameterValueDescription =
  "Return the value of a parameter of the class as the literal text of its binding.";

export async function getParameterValue(
  ctx: CallContext,
  input: GetParameterValueInput,
): Promise<GetParameterValueOutput> {
  const raw = await ctx.call(
    `getParameterValue(${input.typeName}, ${quote(input.name)})`,
  );
  const v = parse(raw);
  let value = "";
  if (!isNull(v)) {
    const s = asString(v);
    if (s !== undefined) {
      value = s;
    } else {
      value = String(asFloat(v) ?? asInt(v) ?? asBool(v) ?? "");
    }
  }
  return parseOutput(
    GetParameterValueOutputSchema,
    { value },
    "getParameterValue",
  );
}
