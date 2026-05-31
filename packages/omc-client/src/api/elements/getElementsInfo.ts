/**
 * OMC: `function getElementsInfo`
 *
 * ```modelica
 * function getElementsInfo
 *   input TypeName className;
 *   output Expression result;
 * end getElementsInfo;
 * ```
 *
 * `result` is a Modelica expression tree describing all elements (extends,
 * components, short class definitions). Returned as the raw `Value` tree.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetElementsInfoInputSchema = TypeNameInput;
export type GetElementsInfoInput = z.input<typeof GetElementsInfoInputSchema>;

export const GetElementsInfoOutputSchema = z.object({
  result: ValueSchema.describe(
    "All elements as a Modelica expression tree (raw `Value`).",
  ),
});
export type GetElementsInfoOutput = z.infer<typeof GetElementsInfoOutputSchema>;

export const GetElementsInfoDescription =
  "Return a Modelica expression tree describing all elements of a class (extends, components, short class definitions).";

export async function getElementsInfo(
  ctx: CallContext,
  input: GetElementsInfoInput,
): Promise<GetElementsInfoOutput> {
  const raw = await ctx.call(`getElementsInfo(${input.typeName})`);
  return parseOutput(
    GetElementsInfoOutputSchema,
    { result: parse(raw) },
    "getElementsInfo",
  );
}
