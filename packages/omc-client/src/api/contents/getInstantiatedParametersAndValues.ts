/**
 * OMC: `function getInstantiatedParametersAndValues`
 *
 * ```modelica
 * function getInstantiatedParametersAndValues
 *   input TypeName cl;
 *   output String[:] result;
 * end getInstantiatedParametersAndValues;
 * ```
 *
 * Returns post-instantiation parameter bindings. Each entry is a flat
 * `name=value` string with values resolved through inheritance and
 * modifications — useful as a display layer when the source-level binding
 * is just `parameter Real k = default.k`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetInstantiatedParametersAndValuesInputSchema = TypeNameInput;
export type GetInstantiatedParametersAndValuesInput = z.input<
  typeof GetInstantiatedParametersAndValuesInputSchema
>;

export const GetInstantiatedParametersAndValuesOutputSchema = z.object({
  result: z
    .array(z.string())
    .describe(
      'Flattened parameter list, one entry per parameter as `name=value` (e.g. `k=1.5`).',
    ),
});
export type GetInstantiatedParametersAndValuesOutput = z.infer<
  typeof GetInstantiatedParametersAndValuesOutputSchema
>;

export const GetInstantiatedParametersAndValuesDescription =
  "Return parameter name=value bindings of an instantiated class with inheritance and modifications resolved.";

export async function getInstantiatedParametersAndValues(
  ctx: CallContext,
  input: GetInstantiatedParametersAndValuesInput,
): Promise<GetInstantiatedParametersAndValuesOutput> {
  const raw = await ctx.call(
    `getInstantiatedParametersAndValues(${input.typeName})`,
  );
  return parseOutput(
    GetInstantiatedParametersAndValuesOutputSchema,
    { result: expectStringList(parse(raw)) },
    "getInstantiatedParametersAndValues",
  );
}
