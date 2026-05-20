/**
 * OMC: `function classAnnotationExists`
 *
 * Returns true if a class annotation named `annotationName` exists on the
 * given class. This is the predicate paired with `addClassAnnotation`.
 *
 * ```modelica
 * function classAnnotationExists
 *   input TypeName className;
 *   input TypeName annotationName;
 *   output Boolean exists;
 * end classAnnotationExists;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const ClassAnnotationExistsInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Fully qualified TypeName of the class to inspect (OMC parameter `className`); emitted bare to OMC.",
    ),
  annotationName: z
    .string()
    .describe(
      "Name of the class annotation to look for (e.g. `Icon`, `experiment`); a TypeName, emitted bare to OMC.",
    ),
});
export type ClassAnnotationExistsInput = z.input<
  typeof ClassAnnotationExistsInputSchema
>;

export const ClassAnnotationExistsOutputSchema = z.object({
  exists: z
    .boolean()
    .describe(
      "True if a class annotation named `annotationName` exists on the class; field name `exists` is OMC verbatim.",
    ),
});
export type ClassAnnotationExistsOutput = z.infer<
  typeof ClassAnnotationExistsOutputSchema
>;

export const ClassAnnotationExistsDescription =
  "Return true if a class annotation with the given name exists on the given class.";

export async function classAnnotationExists(
  ctx: CallContext,
  input: ClassAnnotationExistsInput,
): Promise<ClassAnnotationExistsOutput> {
  const raw = await ctx.call(
    `classAnnotationExists(${input.typeName}, ${input.annotationName})`,
  );
  return parseOutput(
    ClassAnnotationExistsOutputSchema,
    { exists: expectBool(parse(raw)) },
    "classAnnotationExists",
  );
}
