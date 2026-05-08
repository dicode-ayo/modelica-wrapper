/**
 * OMC: `function getParameterValue`
 *
 * Returns the literal text of a parameter's value, or "" if unset.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asBool, asFloat, asInt, asString, isNull, parse } from "../../parse.js";

export const GetParameterValueInputSchema = z.object({
  typeName: z.string(),
  name: z.string(),
});
export type GetParameterValueInput = z.input<
  typeof GetParameterValueInputSchema
>;

export const GetParameterValueOutputSchema = StringValueOutput;
export type GetParameterValueOutput = z.infer<
  typeof GetParameterValueOutputSchema
>;

export async function getParameterValue(
  ctx: CallContext,
  input: GetParameterValueInput,
): Promise<GetParameterValueOutput> {
  const raw = await ctx.call(
    `getParameterValue(${input.typeName}, ${input.name})`,
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
