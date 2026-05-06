/**
 * OMC: `function deleteComponent`
 *
 * Remove a component from a class.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const DeleteComponentInputSchema = z.object({
  componentName: z.string(),
  typeName: z.string(),
});
export type DeleteComponentInput = z.input<typeof DeleteComponentInputSchema>;

export const DeleteComponentOutputSchema = z.object({
  success: z.boolean(),
});
export type DeleteComponentOutput = z.infer<typeof DeleteComponentOutputSchema>;

export async function deleteComponent(
  ctx: CallContext,
  input: DeleteComponentInput,
): Promise<DeleteComponentOutput> {
  const raw = await ctx.call(
    `deleteComponent(${input.componentName}, ${input.typeName})`,
  );
  return parseOutput(
    DeleteComponentOutputSchema,
    { success: expectBool(parse(raw)) },
    "deleteComponent",
  );
}
