/**
 * Set the `info` section of a class's `Documentation` annotation, preserving
 * its current `revisions` and `__OpenModelica_infoHeader` untouched.
 *
 * OMC's own `setDocumentationAnnotation` has no parameter for `infoHeader`
 * and clears any section it isn't handed, so it can't be used on a class that
 * carries one without destroying it. This reads the class's current
 * annotation first and reconstructs the whole `Documentation` clause through
 * `addClassAnnotation`, which replaces the annotation wholesale — the same
 * read-full/write-full pattern `writeClassGraphics` uses for `Icon`/`Diagram`
 * — so a write never drops a section it wasn't asked to change.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { getDocumentationAnnotation } from "../contents/getDocumentationAnnotation.js";

import { addClassAnnotation } from "./addClassAnnotation.js";

export const SetFullDocumentationAnnotationInputSchema = z.object({
  typeName: z.string().describe("Class to annotate."),
  info: z
    .string()
    .optional()
    .describe(
      "HTML body for the Documentation `info` section; empty clears it.",
    ),
});
export type SetFullDocumentationAnnotationInput = z.input<
  typeof SetFullDocumentationAnnotationInputSchema
>;

export const SetFullDocumentationAnnotationOutputSchema = SuccessOutput;
export type SetFullDocumentationAnnotationOutput = z.infer<
  typeof SetFullDocumentationAnnotationOutputSchema
>;

export const SetFullDocumentationAnnotationDescription =
  "Set a class's Documentation info section, preserving its current revisions and __OpenModelica_infoHeader untouched.";

export async function setFullDocumentationAnnotation(
  ctx: CallContext,
  input: SetFullDocumentationAnnotationInput,
): Promise<SetFullDocumentationAnnotationOutput> {
  const info = input.info ?? "";
  const { revision, infoHeader } = await getDocumentationAnnotation(ctx, {
    typeName: input.typeName,
  });
  const annotation = `Documentation(info=${quote(info)}, revisions=${quote(revision)}, __OpenModelica_infoHeader=${quote(infoHeader)})`;
  return addClassAnnotation(ctx, { typeName: input.typeName, annotation });
}
