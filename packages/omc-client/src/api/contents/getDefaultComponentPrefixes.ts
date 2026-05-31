/**
 * OMC: `function getDefaultComponentPrefixes`
 *
 * ```modelica
 * function getDefaultComponentPrefixes
 *   input TypeName cl;
 *   output String prefixes;
 * end getDefaultComponentPrefixes;
 * ```
 *
 * Returns the class's `defaultComponentPrefixes` annotation (e.g. "inner",
 * "parameter") used by editors when creating instances.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetDefaultComponentPrefixesInputSchema = TypeNameInput;
export type GetDefaultComponentPrefixesInput = z.input<
  typeof GetDefaultComponentPrefixesInputSchema
>;

export const GetDefaultComponentPrefixesOutputSchema = z.object({
  prefixes: z
    .string()
    .describe(
      "Value of the class's `defaultComponentPrefixes` annotation; empty if not set.",
    ),
});
export type GetDefaultComponentPrefixesOutput = z.infer<
  typeof GetDefaultComponentPrefixesOutputSchema
>;

export const GetDefaultComponentPrefixesDescription =
  "Return the value of the class's `defaultComponentPrefixes` annotation (e.g. `inner`, `parameter`) used by editors when creating instances.";

export async function getDefaultComponentPrefixes(
  ctx: CallContext,
  input: GetDefaultComponentPrefixesInput,
): Promise<GetDefaultComponentPrefixesOutput> {
  const raw = await ctx.call(`getDefaultComponentPrefixes(${input.typeName})`);
  return parseOutput(
    GetDefaultComponentPrefixesOutputSchema,
    { prefixes: asString(parse(raw)) ?? "" },
    "getDefaultComponentPrefixes",
  );
}
