/**
 * OMC: `function isConnector`
 *
 * ```modelica
 * function isConnector
 *   input TypeName cl;
 *   output Boolean b;
 * end isConnector;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsConnectorInputSchema = TypeNameInput;
export type IsConnectorInput = z.input<typeof IsConnectorInputSchema>;

export const IsConnectorOutputSchema = z.object({
  b: z.boolean(),
});
export type IsConnectorOutput = z.infer<typeof IsConnectorOutputSchema>;

export async function isConnector(
  ctx: CallContext,
  input: IsConnectorInput,
): Promise<IsConnectorOutput> {
  const raw = await ctx.call(`isConnector(${input.typeName})`);
  return parseOutput(
    IsConnectorOutputSchema,
    { b: expectBool(parse(raw)) },
    "isConnector",
  );
}
