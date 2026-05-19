/**
 * OMC: `function getAnnotationModifierValue`
 *
 * ```modelica
 * function getAnnotationModifierValue
 *   input TypeName className;
 *   input String annotation;
 *   input String modifier;
 *   output String value;
 * end getAnnotationModifierValue;
 * ```
 *
 * Returns the raw text of a single named modifier inside a class-level
 * annotation block. Pair with `getAnnotationNamedModifiers` to enumerate
 * first, then read individual values.
 *
 * NOTE: Despite the OMC docs declaring `output String value`, the
 * interactive scripting channel does NOT always wrap the result in
 * quotes — for complex modifiers like `Icon`'s `graphics` it emits a raw
 * brace-list of `$Code(...)` calls. The wrapper therefore returns the
 * trimmed response verbatim and leaves any further parsing to the caller.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";

export const GetAnnotationModifierValueInputSchema = TypeNameInput.extend({
  annotation: z
    .string()
    .describe("Name of the annotation block (e.g. `Documentation`, `Icon`)."),
  modifier: z
    .string()
    .describe(
      "Named modifier within the annotation to read (e.g. `info` for `Documentation`).",
    ),
});
export type GetAnnotationModifierValueInput = z.input<
  typeof GetAnnotationModifierValueInputSchema
>;

export const GetAnnotationModifierValueOutputSchema = StringValueOutput;
export type GetAnnotationModifierValueOutput = z.infer<
  typeof GetAnnotationModifierValueOutputSchema
>;

export const GetAnnotationModifierValueDescription =
  "Return the literal value of a single named modifier inside a class-level annotation block.";

export async function getAnnotationModifierValue(
  ctx: CallContext,
  input: GetAnnotationModifierValueInput,
): Promise<GetAnnotationModifierValueOutput> {
  const raw = await ctx.call(
    `getAnnotationModifierValue(${input.typeName}, ${quote(input.annotation)}, ${quote(input.modifier)})`,
  );
  return parseOutput(
    GetAnnotationModifierValueOutputSchema,
    { value: raw.trim() },
    "getAnnotationModifierValue",
  );
}
