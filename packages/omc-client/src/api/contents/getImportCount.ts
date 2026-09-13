/**
 * OMC: `function getImportCount`
 *
 * Counts the number of `import`-clauses in a class.
 *
 * ```modelica
 * function getImportCount
 *   input TypeName class_;
 *   output Integer count;
 * end getImportCount;
 * ```
 *
 * The `import` clauses are also visible in the structured AST returned by
 * `getModelInstance`, so this wrapper is mostly for parity with the OMC
 * scripting docs and for callers that haven't moved to the structured-AST
 * endpoint.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetImportCountInputSchema = TypeNameInput;
export type GetImportCountInput = z.input<typeof GetImportCountInputSchema>;

export const GetImportCountOutputSchema = z.object({
  count: z
    .number()
    .int()
    .describe("Number of `import`-clauses declared in the class."),
});
export type GetImportCountOutput = z.infer<typeof GetImportCountOutputSchema>;

export const GetImportCountDescription =
  "Count the number of `import`-clauses in a class.";

export async function getImportCount(
  ctx: CallContext,
  input: GetImportCountInput,
): Promise<GetImportCountOutput> {
  const raw = await ctx.call(`getImportCount(${input.typeName})`);
  return parseOutput(
    GetImportCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getImportCount",
  );
}
