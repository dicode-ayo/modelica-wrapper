/**
 * OMC: `function setComponentProperties`
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
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const SetComponentPropertiesInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
  finalPrefix: z.boolean(),
  flow: z.boolean(),
  stream: z.boolean(),
  protectedPrefix: z.boolean(),
  replaceablePrefix: z.boolean(),
  /** "constant" | "parameter" | "discrete" | "" (continuous). */
  variability: z.string(),
  inner: z.boolean(),
  outer: z.boolean(),
  /** "input" | "output" | "". */
  direction: z.string(),
});
export type SetComponentPropertiesInput = z.input<
  typeof SetComponentPropertiesInputSchema
>;

export const SetComponentPropertiesOutputSchema = z.object({
  success: z.boolean(),
});
export type SetComponentPropertiesOutput = z.infer<
  typeof SetComponentPropertiesOutputSchema
>;

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
