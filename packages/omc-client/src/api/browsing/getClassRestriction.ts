/**
 * OMC: `function getClassRestriction`
 *
 * ```modelica
 * function getClassRestriction
 *   input TypeName cl;
 *   output String restriction;
 * end getClassRestriction;
 * ```
 *
 * Returns the restriction keyword: `"model"`, `"block"`, `"package"`,
 * `"function"`, `"class"`, `"connector"`, `"type"`, `"record"`, `"operator"`,
 * etc.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetClassRestrictionInputSchema = TypeNameInput;
export type GetClassRestrictionInput = z.input<
  typeof GetClassRestrictionInputSchema
>;

export const GetClassRestrictionOutputSchema = z.object({
  restriction: z.string(),
});
export type GetClassRestrictionOutput = z.infer<
  typeof GetClassRestrictionOutputSchema
>;

export async function getClassRestriction(
  ctx: CallContext,
  input: GetClassRestrictionInput,
): Promise<GetClassRestrictionOutput> {
  const raw = await ctx.call(`getClassRestriction(${input.typeName})`);
  return parseOutput(
    GetClassRestrictionOutputSchema,
    { restriction: asString(parse(raw)) ?? "" },
    "getClassRestriction",
  );
}
