/**
 * OMC: `function getComponentComment`
 *
 * ```modelica
 * function getComponentComment
 *   input TypeName className;
 *   input TypeName componentName;
 *   output String comment;
 * end getComponentComment;
 * ```
 *
 * `componentName` is a dotted path TypeName emitted bare.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetComponentCommentInputSchema = TypeNameAndComponentNameInput;
export type GetComponentCommentInput = z.input<
  typeof GetComponentCommentInputSchema
>;

export const GetComponentCommentOutputSchema = z.object({
  comment: z.string().describe("Component description-string comment; empty if none."),
});
export type GetComponentCommentOutput = z.infer<
  typeof GetComponentCommentOutputSchema
>;

export const GetComponentCommentDescription = "Return the description-string comment on a component declaration within a class.";

export async function getComponentComment(
  ctx: CallContext,
  input: GetComponentCommentInput,
): Promise<GetComponentCommentOutput> {
  const raw = await ctx.call(
    `getComponentComment(${input.typeName}, ${input.componentName})`,
  );
  return parseOutput(
    GetComponentCommentOutputSchema,
    { comment: asString(parse(raw)) ?? "" },
    "getComponentComment",
  );
}
