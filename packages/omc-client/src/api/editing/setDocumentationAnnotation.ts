/**
 * OMC: `function setDocumentationAnnotation`
 *
 * ```modelica
 * function setDocumentationAnnotation
 *   input TypeName class_;
 *   input String info = "";
 *   input String revisions = "";
 *   output Boolean bool;
 * end setDocumentationAnnotation;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const SetDocumentationAnnotationInputSchema = z.object({
  typeName: z.string(),
  info: z.string().optional().default(""),
  revisions: z.string().optional().default(""),
});
export type SetDocumentationAnnotationInput = z.input<
  typeof SetDocumentationAnnotationInputSchema
>;

export const SetDocumentationAnnotationOutputSchema = z.object({
  bool: z.boolean(),
});
export type SetDocumentationAnnotationOutput = z.infer<
  typeof SetDocumentationAnnotationOutputSchema
>;

export async function setDocumentationAnnotation(
  ctx: CallContext,
  input: SetDocumentationAnnotationInput,
): Promise<SetDocumentationAnnotationOutput> {
  const info = input.info ?? "";
  const revisions = input.revisions ?? "";
  const raw = await ctx.call(
    `setDocumentationAnnotation(${input.typeName}, ${quote(info)}, ${quote(revisions)})`,
  );
  return parseOutput(
    SetDocumentationAnnotationOutputSchema,
    {
      bool: await parseMutationSuccess(ctx, raw, "setDocumentationAnnotation"),
    },
    "setDocumentationAnnotation",
  );
}
