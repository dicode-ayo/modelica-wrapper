/**
 * Set the full `Documentation` annotation on a class — `info`, `revisions`,
 * and `__OpenModelica_infoHeader` together.
 *
 * OMC's own `setDocumentationAnnotation` has no parameter for `infoHeader`
 * and clears any section it isn't handed, so it can't be used on a class that
 * carries one without destroying it. This composes the whole `Documentation`
 * clause and writes it through `addClassAnnotation`, which replaces the
 * annotation wholesale — the same read-full/write-full pattern
 * `writeClassGraphics` uses for `Icon`/`Diagram` — so every write must carry
 * every section it wants kept.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";

import { addClassAnnotation } from "./addClassAnnotation.js";

export const SetFullDocumentationAnnotationInputSchema = z.object({
  typeName: z.string().describe("Class to annotate."),
  info: z
    .string()
    .optional()
    .default("")
    .describe(
      "HTML body for the Documentation `info` section; empty clears it.",
    ),
  revisions: z
    .string()
    .optional()
    .default("")
    .describe(
      "HTML body for the Documentation `revisions` section; empty clears it.",
    ),
  infoHeader: z
    .string()
    .optional()
    .default("")
    .describe(
      "HTML body for the Documentation `__OpenModelica_infoHeader` section; empty clears it.",
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
  "Set the full Documentation annotation on a class (info, revisions, and __OpenModelica_infoHeader together), preserving whichever sections aren't being changed.";

export async function setFullDocumentationAnnotation(
  ctx: CallContext,
  input: SetFullDocumentationAnnotationInput,
): Promise<SetFullDocumentationAnnotationOutput> {
  const info = input.info ?? "";
  const revisions = input.revisions ?? "";
  const infoHeader = input.infoHeader ?? "";
  const annotation = `Documentation(info=${quote(info)}, revisions=${quote(revisions)}, __OpenModelica_infoHeader=${quote(infoHeader)})`;
  return addClassAnnotation(ctx, { typeName: input.typeName, annotation });
}
