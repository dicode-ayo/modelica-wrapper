/**
 * OMC: `function updateComponent`
 *
 * Updates a component's annotation (typically Placement). Same shape as
 * addComponent — used to move a component on the canvas.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const UpdateComponentInputSchema = z.object({
  componentName: z.string(),
  componentClass: z.string(),
  intoTypeName: z.string(),
  annotation: z.string().optional().default(""),
});
export type UpdateComponentInput = z.input<typeof UpdateComponentInputSchema>;

export const UpdateComponentOutputSchema = SuccessOutput;
export type UpdateComponentOutput = z.infer<typeof UpdateComponentOutputSchema>;

export async function updateComponent(
  ctx: CallContext,
  input: UpdateComponentInput,
): Promise<UpdateComponentOutput> {
  const annotation = input.annotation ?? "";
  const ann =
    annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `updateComponent(${input.componentName}, ${input.componentClass}, ${input.intoTypeName}, ${ann})`,
  );
  return parseOutput(
    UpdateComponentOutputSchema,
    { success: expectBool(parse(raw)) },
    "updateComponent",
  );
}
