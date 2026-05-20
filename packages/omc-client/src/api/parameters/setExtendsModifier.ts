/**
 * OMC: `function setExtendsModifier`
 *
 * ```modelica
 * function setExtendsModifier
 *   input TypeName className;
 *   input TypeName extendsName;
 *   input ExpressionOrModification modifier;
 *   output Boolean success;
 * end setExtendsModifier;
 * ```
 *
 * Sets the *whole* modification on an `extends` clause (e.g. `(k = 3.7)`),
 * as opposed to `setExtendsModifierValue` which targets a single named
 * element within the clause. NOT a deprecated alias — confirmed a distinct
 * 3-arg function on the pin (its docs page lists no deprecation note).
 *
 * The modification is wrapped in `$Code(…)` to bypass OMC's interactive-RPC
 * string escaping. Unlike the single-value setters (`setExtendsModifierValue`,
 * `setComponentModifierValue`), the argument is an `ExpressionOrModification`
 * (a parenthesised modification like `(k = 3.7)`), so it is NOT prefixed with
 * `=` — `$Code(=(k = 3.7))` is a syntax error on the pin.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { extendsBase, typeNameOfExtends } from "../../_shared/fields.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetExtendsModifierInputSchema = z.object({
  typeName: typeNameOfExtends,
  extendsName: extendsBase.describe(
    "TypeName of the base class on the `extends` clause to mutate.",
  ),
  modifier: z
    .string()
    .describe(
      "Raw Modelica modification to apply to the `extends` clause (e.g. `(k = 3.7)`), wrapped in `$Code(…)` for OMC; empty clears the modification.",
    ),
});
export type SetExtendsModifierInput = z.input<
  typeof SetExtendsModifierInputSchema
>;

export const SetExtendsModifierOutputSchema = SuccessOutput;
export type SetExtendsModifierOutput = z.infer<
  typeof SetExtendsModifierOutputSchema
>;

export const SetExtendsModifierDescription =
  "Set the whole modification on an `extends` clause in a class definition.";

export async function setExtendsModifier(
  ctx: CallContext,
  input: SetExtendsModifierInput,
): Promise<SetExtendsModifierOutput> {
  const codeArg =
    input.modifier === "" ? "$Code(())" : `$Code(${input.modifier})`;
  const raw = await ctx.call(
    `setExtendsModifier(${input.typeName}, ${input.extendsName}, ${codeArg})`,
  );
  return parseOutput(
    SetExtendsModifierOutputSchema,
    { success: expectBool(parse(raw)) },
    "setExtendsModifier",
  );
}
