/**
 * OMC: `function getModelInstance`
 *
 * ```modelica
 * function getModelInstance
 *   input TypeName className;
 *   input String modifier = "";
 *   input Boolean prettyPrint = false;
 *   output String result;
 * end getModelInstance;
 * ```
 *
 * The result is a JSON document describing the model instance (parameters,
 * components, connections, inheritance, etc.). Wrappers do not parse the JSON;
 * callers `JSON.parse(result)` themselves.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetModelInstanceInputSchema = z.object({
  typeName: z.string(),
  modifier: z.string().optional().default(""),
  prettyPrint: z.boolean().optional().default(false),
});
export type GetModelInstanceInput = z.input<typeof GetModelInstanceInputSchema>;

export const GetModelInstanceOutputSchema = z.object({
  result: z.string(),
});
export type GetModelInstanceOutput = z.infer<
  typeof GetModelInstanceOutputSchema
>;

export async function getModelInstance(
  ctx: CallContext,
  input: GetModelInstanceInput,
): Promise<GetModelInstanceOutput> {
  const modifier = input.modifier ?? "";
  const prettyPrint = input.prettyPrint ?? false;
  const raw = await ctx.call(
    `getModelInstance(${input.typeName}, ${quote(modifier)}, ${mlBool(prettyPrint)})`,
  );
  return parseOutput(
    GetModelInstanceOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getModelInstance",
  );
}
