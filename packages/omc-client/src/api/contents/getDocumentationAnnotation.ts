/**
 * OMC: `function getDocumentationAnnotation`
 *
 * Returns the `Documentation` annotation defined on the class, split into the
 * three OMC-documented strings: info, revision, and infoHeader.
 *
 * ```modelica
 * function getDocumentationAnnotation
 *   input TypeName cl;
 *   output String out[3] "{info,revision,infoHeader}";
 * end getDocumentationAnnotation;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetDocumentationAnnotationInputSchema = TypeNameInput;
export type GetDocumentationAnnotationInput = z.input<
  typeof GetDocumentationAnnotationInputSchema
>;

export const GetDocumentationAnnotationOutputSchema = z.object({
  info: z.string().describe("`info` HTML body of the Documentation annotation."),
  revision: z.string().describe("`revisions` HTML body of the Documentation annotation."),
  infoHeader: z.string().describe("`infoHeader` HTML body of the Documentation annotation."),
});
export type GetDocumentationAnnotationOutput = z.infer<
  typeof GetDocumentationAnnotationOutputSchema
>;

export const GetDocumentationAnnotationDescription =
  "Return the `Documentation` annotation defined on the class, split into info, revision, and infoHeader.";

export async function getDocumentationAnnotation(
  ctx: CallContext,
  input: GetDocumentationAnnotationInput,
): Promise<GetDocumentationAnnotationOutput> {
  const raw = await ctx.call(
    `getDocumentationAnnotation(${input.typeName})`,
  );
  const fields = expectStringList(parse(raw));
  return parseOutput(
    GetDocumentationAnnotationOutputSchema,
    {
      info: fields[0] ?? "",
      revision: fields[1] ?? "",
      infoHeader: fields[2] ?? "",
    },
    "getDocumentationAnnotation",
  );
}
