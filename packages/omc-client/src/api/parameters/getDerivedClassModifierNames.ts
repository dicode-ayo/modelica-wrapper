/**
 * OMC: `function getDerivedClassModifierNames`
 *
 * ```modelica
 * function getDerivedClassModifierNames
 *   input TypeName className;
 *   output String[:] modifierNames;
 * end getDerivedClassModifierNames;
 * ```
 *
 * Returns the names of the modifiers a *derived* (short-class-definition)
 * class applies to its base type. For example, a `Resistance` type derived
 * from `Real` with `quantity` and `unit` modifiers returns
 * `{"quantity", "unit"}`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetDerivedClassModifierNamesInputSchema = TypeNameInput;
export type GetDerivedClassModifierNamesInput = z.input<
  typeof GetDerivedClassModifierNamesInputSchema
>;

export const GetDerivedClassModifierNamesOutputSchema = z.object({
  modifierNames: z
    .array(z.string())
    .describe(
      "Modifier names applied by the derived class to its base type (e.g. `quantity`, `unit`).",
    ),
});
export type GetDerivedClassModifierNamesOutput = z.infer<
  typeof GetDerivedClassModifierNamesOutputSchema
>;

export const GetDerivedClassModifierNamesDescription =
  "Return the modifier names a derived class applies to its base type.";

export async function getDerivedClassModifierNames(
  ctx: CallContext,
  input: GetDerivedClassModifierNamesInput,
): Promise<GetDerivedClassModifierNamesOutput> {
  const raw = await ctx.call(`getDerivedClassModifierNames(${input.typeName})`);
  return parseOutput(
    GetDerivedClassModifierNamesOutputSchema,
    { modifierNames: expectStringList(parse(raw)) },
    "getDerivedClassModifierNames",
  );
}
