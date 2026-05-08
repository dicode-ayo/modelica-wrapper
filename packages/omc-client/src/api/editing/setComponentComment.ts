/**
 * OMC: `function setComponentComment`
 *
 * Set the description-string comment on a component.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetComponentCommentInputSchema =
  TypeNameAndComponentNameInput.extend({
    comment: z.string().describe("New description-string for the component (without surrounding quotes)."),
  });
export type SetComponentCommentInput = z.input<
  typeof SetComponentCommentInputSchema
>;

export const SetComponentCommentOutputSchema = SuccessOutput;
export type SetComponentCommentOutput = z.infer<
  typeof SetComponentCommentOutputSchema
>;

export const SetComponentCommentDescription = "Set the description-string comment on a component.";

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
