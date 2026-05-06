/**
 * OMC: `function setComponentProperties`
 *
 * Set the prefix flags + variability/causality/innerOuter on a component.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetComponentPropertiesInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
  finalPrefix: z.boolean(),
  flow: z.boolean(),
  stream: z.boolean(),
  replaceablePrefix: z.boolean(),
  /** "constant" | "parameter" | "discrete" | "" (continuous). */
  variability: z.string(),
  /** "input" | "output" | "". */
  causality: z.string(),
  /** "inner" | "outer" | "inner outer" | "". */
  innerOuter: z.string(),
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
    `setComponentProperties(${input.typeName}, ${input.componentName}, {${mlBool(input.finalPrefix)},${mlBool(input.flow)},${mlBool(input.stream)},${mlBool(input.replaceablePrefix)}}, {${quote(input.variability)}, ${quote(input.causality)}, ${quote(input.innerOuter)}})`,
  );
  return parseOutput(
    SetComponentPropertiesOutputSchema,
    { success: expectBool(parse(raw)) },
    "setComponentProperties",
  );
}
