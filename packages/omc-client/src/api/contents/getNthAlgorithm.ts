/**
 * OMC: `function getNthAlgorithm`
 *
 * Returns the n-th `algorithm` section in a class as a Modelica source string.
 *
 * ```modelica
 * function getNthAlgorithm
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthAlgorithm;
 * ```
 *
 * `index` is 1-based, in `1..getAlgorithmCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthAlgorithmInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe(
      "1-based algorithm-section index, between 1 and `getAlgorithmCount`.",
    ),
});
export type GetNthAlgorithmInput = z.input<typeof GetNthAlgorithmInputSchema>;

export const GetNthAlgorithmOutputSchema = z.object({
  result: z
    .string()
    .describe(
      "The n-th `algorithm` section as a Modelica source string. Field name `result` is OMC verbatim.",
    ),
});
export type GetNthAlgorithmOutput = z.infer<typeof GetNthAlgorithmOutputSchema>;

export const GetNthAlgorithmDescription =
  "Return the n-th `algorithm` section in a class as a Modelica source string. Pairs with `getAlgorithmCount`.";

export async function getNthAlgorithm(
  ctx: CallContext,
  input: GetNthAlgorithmInput,
): Promise<GetNthAlgorithmOutput> {
  const raw = await ctx.call(
    `getNthAlgorithm(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthAlgorithmOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthAlgorithm",
  );
}
