/**
 * OMC: `function getClassComment`
 *
 * ```modelica
 * function getClassComment
 *   input TypeName cl;
 *   output String comment;
 * end getClassComment;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetClassCommentInputSchema = TypeNameInput;
export type GetClassCommentInput = z.input<typeof GetClassCommentInputSchema>;

export const GetClassCommentOutputSchema = z.object({
  comment: z.string(),
});
export type GetClassCommentOutput = z.infer<
  typeof GetClassCommentOutputSchema
>;

export async function getClassComment(
  ctx: CallContext,
  input: GetClassCommentInput,
): Promise<GetClassCommentOutput> {
  const raw = await ctx.call(`getClassComment(${input.typeName})`);
  return parseOutput(
    GetClassCommentOutputSchema,
    { comment: asString(parse(raw)) ?? "" },
    "getClassComment",
  );
}
