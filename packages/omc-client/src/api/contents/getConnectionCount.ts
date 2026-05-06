/**
 * OMC: `function getConnectionCount`
 *
 * Returns the number of `connect(...)` statements in a class.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetConnectionCountInputSchema = TypeNameInput;
export type GetConnectionCountInput = z.input<
  typeof GetConnectionCountInputSchema
>;

export const GetConnectionCountOutputSchema = z.object({
  count: z.number().int(),
});
export type GetConnectionCountOutput = z.infer<
  typeof GetConnectionCountOutputSchema
>;

export async function getConnectionCount(
  ctx: CallContext,
  input: GetConnectionCountInput,
): Promise<GetConnectionCountOutput> {
  const raw = await ctx.call(`getConnectionCount(${input.typeName})`);
  return parseOutput(
    GetConnectionCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getConnectionCount",
  );
}
