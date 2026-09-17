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
 *
 * Scoped to the parameters the class declares directly: a subcomponent's
 * parameters (the normal shape for anything built by `addComponent`) are not
 * included, and the class comes back with an empty result rather than an
 * error. Read a subcomponent's value with `getElementModifierValues`
 * (dotted modifier path, e.g. `resistor.R`).
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
      "Flattened parameter list, one entry per parameter as `name=value` (e.g. `k=1.5`).",
    ),
});
export type GetInstantiatedParametersAndValuesOutput = z.infer<
  typeof GetInstantiatedParametersAndValuesOutputSchema
>;

export const GetInstantiatedParametersAndValuesDescription =
  "Return name=value bindings for the parameters this class declares directly, with inheritance and its own modifications resolved. Does not descend into subcomponents — a class whose parameters live on its subcomponents (the normal shape for anything built by addComponent) returns an empty list, not an error. For a subcomponent's value (e.g. `resistor.R`), use getElementModifierValues with a dotted modifier path.";

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
