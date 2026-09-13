/**
 * OMC: `function getNthConnector`
 *
 * ```modelica
 * function getNthConnector
 *   input TypeName className;
 *   input Integer n;
 *   output Expression result;
 * end getNthConnector;
 * ```
 *
 * `result` is a Modelica expression tree describing the connector. Returned
 * as the raw `Value` tree.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndIndexInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthConnectorInputSchema = TypeNameAndIndexInput;
export type GetNthConnectorInput = z.input<typeof GetNthConnectorInputSchema>;

export const GetNthConnectorOutputSchema = z.object({
  result: ValueSchema.describe(
    "Connector declaration as a Modelica expression tree (raw `Value`).",
  ),
});
export type GetNthConnectorOutput = z.infer<typeof GetNthConnectorOutputSchema>;

export const GetNthConnectorDescription =
  "Return the n-th connector declaration of a class as the raw `Value` expression tree.";

export async function getNthConnector(
  ctx: CallContext,
  input: GetNthConnectorInput,
): Promise<GetNthConnectorOutput> {
  const raw = await ctx.call(`getNthConnector(${input.typeName}, ${input.n})`);
  return parseOutput(
    GetNthConnectorOutputSchema,
    { result: parse(raw) },
    "getNthConnector",
  );
}
