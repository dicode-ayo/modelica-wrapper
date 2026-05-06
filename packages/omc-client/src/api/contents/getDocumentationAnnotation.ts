/**
 * OMC: `function getDocumentationAnnotation`
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
  info: z.string(),
  revision: z.string(),
  infoHeader: z.string(),
});
export type GetDocumentationAnnotationOutput = z.infer<
  typeof GetDocumentationAnnotationOutputSchema
>;

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
