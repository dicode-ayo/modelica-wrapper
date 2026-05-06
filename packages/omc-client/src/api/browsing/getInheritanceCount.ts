/**
 * OMC: `function getInheritanceCount`
 *
 * ```modelica
 * function getInheritanceCount
 *   input TypeName className;
 *   output Integer count;
 * end getInheritanceCount;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetInheritanceCountInputSchema = TypeNameInput;
export type GetInheritanceCountInput = z.input<
  typeof GetInheritanceCountInputSchema
>;

export const GetInheritanceCountOutputSchema = z.object({
  count: z.number().int(),
});
export type GetInheritanceCountOutput = z.infer<
  typeof GetInheritanceCountOutputSchema
>;

export async function getInheritanceCount(
  ctx: CallContext,
  input: GetInheritanceCountInput,
): Promise<GetInheritanceCountOutput> {
  const raw = await ctx.call(`getInheritanceCount(${input.typeName})`);
  return parseOutput(
    GetInheritanceCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getInheritanceCount",
  );
}
