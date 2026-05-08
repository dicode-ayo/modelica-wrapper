/**
 * OMC: `function getConnectorCount`
 *
 * ```modelica
 * function getConnectorCount
 *   input TypeName className;
 *   output Integer count;
 * end getConnectorCount;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetConnectorCountInputSchema = TypeNameInput;
export type GetConnectorCountInput = z.input<
  typeof GetConnectorCountInputSchema
>;

export const GetConnectorCountOutputSchema = z.object({
  count: z.number().int(),
});
export type GetConnectorCountOutput = z.infer<
  typeof GetConnectorCountOutputSchema
>;

export async function getConnectorCount(
  ctx: CallContext,
  input: GetConnectorCountInput,
): Promise<GetConnectorCountOutput> {
  const raw = await ctx.call(`getConnectorCount(${input.typeName})`);
  return parseOutput(
    GetConnectorCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getConnectorCount",
  );
}
