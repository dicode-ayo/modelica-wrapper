/**
 * OMC: `function isExtendsModifierFinal`
 *
 * ```modelica
 * function isExtendsModifierFinal
 *   input TypeName className;
 *   input TypeName extendsName;
 *   input TypeName modifierName;
 *   output Boolean isFinal;
 * end isExtendsModifierFinal;
 * ```
 *
 * Reports whether a modifier on an `extends` clause is declared `final`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { extendsBase, typeNameOfExtends } from "../../_shared/fields.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsExtendsModifierFinalInputSchema = z.object({
  typeName: typeNameOfExtends,
  extendsName: extendsBase.describe(
    "TypeName of the base class on the `extends` clause to inspect.",
  ),
  // OMC's `modifierName` is a secondary TypeName arg (a member path), so it
  // keeps the OMC docs name verbatim (audit.md §2.3).
  modifierName: z
    .string()
    .describe("Name of the modifier on the `extends` clause to inspect; emitted bare to OMC."),
});
export type IsExtendsModifierFinalInput = z.input<
  typeof IsExtendsModifierFinalInputSchema
>;

export const IsExtendsModifierFinalOutputSchema = z.object({
  isFinal: z
    .boolean()
    .describe(
      "True if the modifier on the `extends` clause is declared `final`; field name `isFinal` is OMC verbatim.",
    ),
});
export type IsExtendsModifierFinalOutput = z.infer<
  typeof IsExtendsModifierFinalOutputSchema
>;

export const IsExtendsModifierFinalDescription =
  "Check whether a modifier on an `extends` clause is declared `final`.";

export async function isExtendsModifierFinal(
  ctx: CallContext,
  input: IsExtendsModifierFinalInput,
): Promise<IsExtendsModifierFinalOutput> {
  const raw = await ctx.call(
    `isExtendsModifierFinal(${input.typeName}, ${input.extendsName}, ${input.modifierName})`,
  );
  return parseOutput(
    IsExtendsModifierFinalOutputSchema,
    { isFinal: expectBool(parse(raw)) },
    "isExtendsModifierFinal",
  );
}
