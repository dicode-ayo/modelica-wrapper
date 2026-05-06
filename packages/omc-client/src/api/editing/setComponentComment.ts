/**
 * OMC: `function setComponentComment`
 *
 * Set the description-string comment on a component.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetComponentCommentInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
  comment: z.string(),
});
export type SetComponentCommentInput = z.input<
  typeof SetComponentCommentInputSchema
>;

export const SetComponentCommentOutputSchema = z.object({
  success: z.boolean(),
});
export type SetComponentCommentOutput = z.infer<
  typeof SetComponentCommentOutputSchema
>;

export async function setComponentComment(
  ctx: CallContext,
  input: SetComponentCommentInput,
): Promise<SetComponentCommentOutput> {
  const raw = await ctx.call(
    `setComponentComment(${input.typeName}, ${input.componentName}, ${quote(input.comment)})`,
  );
  return parseOutput(
    SetComponentCommentOutputSchema,
    { success: expectBool(parse(raw)) },
    "setComponentComment",
  );
}
