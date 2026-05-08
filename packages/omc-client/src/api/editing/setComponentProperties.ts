/**
 * OMC: `function setComponentProperties`
 *
 * Sets the prefix flags, variability, inner/outer, and direction of a
 * component in a class.
 *
 * ```modelica
 * function setComponentProperties
 *   input TypeName className;
 *   input TypeName componentName;
 *   input Boolean[:] prefixArray;       // {final, flow, stream, protected, replaceable}
 *   input String[1] variability;        // {""|"constant"|"discrete"|"parameter"}
 *   input Boolean[2] innerOuter;        // {inner, outer}
 *   input String[1] direction;          // {""|"input"|"output"}
 *   output Boolean success;
 * end setComponentProperties;
 * ```
 *
 * Note `prefixArray` is 5 booleans (final, flow, stream, protected, replaceable),
 * `variability` and `direction` are 1-element string arrays, and `innerOuter`
 * is a 2-element boolean array. Earlier OMC versions accepted a different
 * shape; this wrapper targets the OMC 1.26 layout (verified 2026-05-05).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const SetComponentPropertiesInputSchema =
  TypeNameAndComponentNameInput.extend({
    finalPrefix: z.boolean().describe("Set the `final` prefix on the component."),
    flow: z.boolean().describe("Set the `flow` prefix."),
    stream: z.boolean().describe("Set the `stream` prefix."),
    protectedPrefix: z.boolean().describe("Place the component in a `protected` section when true."),
    replaceablePrefix: z.boolean().describe("Set the `replaceable` prefix on the component."),
    /** "constant" | "parameter" | "discrete" | "" (continuous). */
    variability: z.string().describe('"constant" | "parameter" | "discrete" | "" (continuous).'),
    inner: z.boolean().describe("Set the `inner` prefix."),
    outer: z.boolean().describe("Set the `outer` prefix."),
    /** "input" | "output" | "". */
    direction: z.string().describe('"input" | "output" | "".'),
  });
export type SetComponentPropertiesInput = z.input<
  typeof SetComponentPropertiesInputSchema
>;

export const SetComponentPropertiesOutputSchema = SuccessOutput;
export type SetComponentPropertiesOutput = z.infer<
  typeof SetComponentPropertiesOutputSchema
>;

export const SetComponentPropertiesDescription =
  "Set the properties of a component in a class (prefix flags, variability, inner/outer, direction).";

export async function setComponentProperties(
  ctx: CallContext,
  input: SetComponentPropertiesInput,
): Promise<SetComponentPropertiesOutput> {
  const raw = await ctx.call(
    `setComponentProperties(${input.typeName}, ${input.componentName}, {${mlBool(input.finalPrefix)},${mlBool(input.flow)},${mlBool(input.stream)},${mlBool(input.protectedPrefix)},${mlBool(input.replaceablePrefix)}}, {${quote(input.variability)}}, {${mlBool(input.inner)},${mlBool(input.outer)}}, {${quote(input.direction)}})`,
  );
  return parseOutput(
    SetComponentPropertiesOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "setComponentProperties") },
    "setComponentProperties",
  );
}
