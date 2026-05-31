/**
 * OMC: `function getDerivedClassModifierValue`
 *
 * ```modelica
 * function getDerivedClassModifierValue
 *   input TypeName className;
 *   input TypeName modifierName;
 *   output String modifierValue;
 * end getDerivedClassModifierValue;
 * ```
 *
 * Returns the value a *derived* (short-class-definition) class binds to a
 * single modifier on its base type. For a `Resistance` type derived from
 * `Real`, asking for `unit` yields `"Ohm"` and `quantity` yields
 * `"Resistance"`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetDerivedClassModifierValueInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Fully qualified TypeName of the derived class; emitted bare to OMC.",
    ),
  // OMC's `modifierName` is a secondary TypeName arg (a member path), so it
  // keeps the OMC docs name verbatim rather than the package-wide `typeName`
  // rename, which only applies to the primary class arg (audit.md §2.3).
  modifierName: z
    .string()
    .describe(
      "Name of the modifier on the base type to read; emitted bare to OMC.",
    ),
});
export type GetDerivedClassModifierValueInput = z.input<
  typeof GetDerivedClassModifierValueInputSchema
>;

export const GetDerivedClassModifierValueOutputSchema = z.object({
  modifierValue: z
    .string()
    .describe(
      "Value the derived class binds to the requested modifier; field name `modifierValue` is OMC verbatim.",
    ),
});
export type GetDerivedClassModifierValueOutput = z.infer<
  typeof GetDerivedClassModifierValueOutputSchema
>;

export const GetDerivedClassModifierValueDescription =
  "Return the value a derived class binds to a single modifier on its base type.";

export async function getDerivedClassModifierValue(
  ctx: CallContext,
  input: GetDerivedClassModifierValueInput,
): Promise<GetDerivedClassModifierValueOutput> {
  const raw = await ctx.call(
    `getDerivedClassModifierValue(${input.typeName}, ${input.modifierName})`,
  );
  // String modifiers (`unit`, `quantity`) come back quoted; numeric ones may
  // come back bare. Fall back to the trimmed raw text so scalar bindings keep
  // OMC's verbatim source rendering.
  const v = parse(raw);
  return parseOutput(
    GetDerivedClassModifierValueOutputSchema,
    { modifierValue: asString(v) ?? raw.trim() },
    "getDerivedClassModifierValue",
  );
}
