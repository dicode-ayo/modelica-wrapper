/**
 * OMC: `function getNthInitialAlgorithm`
 *
 * Returns the n-th `initial algorithm` section in a class as a Modelica source
 * string.
 *
 * ```modelica
 * function getNthInitialAlgorithm
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthInitialAlgorithm;
 * ```
 *
 * `index` is 1-based, in `1..getInitialAlgorithmCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthInitialAlgorithmInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe(
      "1-based initial-algorithm-section index, between 1 and `getInitialAlgorithmCount`.",
    ),
});
export type GetNthInitialAlgorithmInput = z.input<
  typeof GetNthInitialAlgorithmInputSchema
>;

export const GetNthInitialAlgorithmOutputSchema = z.object({
  result: z
    .string()
    .describe(
      "The n-th `initial algorithm` section as a Modelica source string. Field name `result` is OMC verbatim.",
    ),
});
export type GetNthInitialAlgorithmOutput = z.infer<
  typeof GetNthInitialAlgorithmOutputSchema
>;

export const GetNthInitialAlgorithmDescription =
  "Return the n-th `initial algorithm` section in a class as a Modelica source string. Pairs with `getInitialAlgorithmCount`.";

export async function getNthInitialAlgorithm(
  ctx: CallContext,
  input: GetNthInitialAlgorithmInput,
): Promise<GetNthInitialAlgorithmOutput> {
  const raw = await ctx.call(
    `getNthInitialAlgorithm(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthInitialAlgorithmOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthInitialAlgorithm",
  );
}
