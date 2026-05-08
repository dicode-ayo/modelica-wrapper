/**
 * OMC: `function setClassComment`
 *
 * ```modelica
 * function setClassComment
 *   input TypeName class_;
 *   input String filename;
 *   output Boolean success;
 * end setClassComment;
 * ```
 *
 * Note: the OMC docs name the second arg `filename`, but in practice it's the
 * new comment text (the parameter is misnamed upstream). The wrapper preserves
 * the doc name verbatim per the package convention.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const SetClassCommentInputSchema = z.object({
  typeName: z.string().describe("Class to update."),
  filename: z.string().describe("New comment text. Misnamed `filename` in OMC docs but actually the comment string; the wrapper preserves the doc name verbatim per the package convention."),
});
export type SetClassCommentInput = z.input<typeof SetClassCommentInputSchema>;

export const SetClassCommentOutputSchema = SuccessOutput;
export type SetClassCommentOutput = z.infer<
  typeof SetClassCommentOutputSchema
>;

export const SetClassCommentDescription =
  "Set the description-string comment on a class. (OMC's docs misname the second arg `filename`; in practice it's the new comment text.)";

export async function setClassComment(
  ctx: CallContext,
  input: SetClassCommentInput,
): Promise<SetClassCommentOutput> {
  const raw = await ctx.call(
    `setClassComment(${input.typeName}, ${quote(input.filename)})`,
  );
  return parseOutput(
    SetClassCommentOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "setClassComment") },
    "setClassComment",
  );
}
