/**
 * OMC: `function setElementAnnotation`
 *
 * ```modelica
 * function setElementAnnotation
 *   input TypeName elementName;
 *   input ExpressionOrModification annotationMod;
 *   output Boolean success;
 * end setElementAnnotation;
 * ```
 *
 * `annotationMod` is the raw annotation body (e.g. `Placement(...)` or
 * `Dialog(group="Tuning")`) — i.e. exactly what would appear inside
 * `annotation(...)`. The wrapper wraps it in `$Code((...))` (double parens,
 * no leading `=`) before sending to OMC. This is the canonical shape used by
 * OMEdit (`OMCProxy::setElementAnnotation` in `OMEdit/OMEditLIB/Element/Element.cpp`
 * sends `"$Code((" + annotation + "))"`).
 *
 * ### Drift trap — DO NOT regress to `$Code(=...)`
 *
 * The leading-`=` form `$Code(=<expr>)` is silently destructive on OMC ≤ 1.26.7:
 * the call returns `true` but the annotation gets CLEARED from the source
 * instead of replaced. The drift-probe at
 * [`../../../test/drift-probe.integration.test.ts`](../../../test/drift-probe.integration.test.ts)
 * keeps a counter-example entry for this so a future OMC version that starts
 * accepting the leading-`=` form is detected without silently breaking the
 * wrapper. See [docs/coverage.md](../../../docs/coverage.md) Elements section
 * and audit.md §2.10 for the full diagnostic story.
 *
 * ### Empty / clear
 *
 * Passing an empty string clears the annotation: we emit `$Code(())`. OMC
 * accepts that as "annotation with no elements" and removes the annotation
 * block from the source.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetElementAnnotationInputSchema = z.object({
  typeName: z.string().describe("Dotted element name within the class (OMC `elementName`, mapped to `typeName` per the package convention)."),
  annotationMod: z.string().describe("Raw annotation body — what would appear inside `annotation(...)`, e.g. `Dialog(group=\"Tuning\")`. The wrapper wraps it in `$Code((…))` (OMEdit-canonical shape) before sending to OMC. Empty string clears the annotation."),
});
export type SetElementAnnotationInput = z.input<
  typeof SetElementAnnotationInputSchema
>;

export const SetElementAnnotationOutputSchema = SuccessOutput;
export type SetElementAnnotationOutput = z.infer<
  typeof SetElementAnnotationOutputSchema
>;

export const SetElementAnnotationDescription =
  "Set the annotation on an element. The annotation body is wrapped in `$Code((…))` (OMEdit-canonical shape) so OMC doesn't string-escape it.";

export async function setElementAnnotation(
  ctx: CallContext,
  input: SetElementAnnotationInput,
): Promise<SetElementAnnotationOutput> {
  // OMEdit canonical: `setElementAnnotation(name, $Code((<expr>)))` — double
  // parens, no leading `=`. The leading-`=` shape is silently destructive on
  // OMC 1.26.7 (returns true but clears the annotation); see the file
  // docstring for the drift-probe counter-example.
  const codeArg = `$Code((${input.annotationMod}))`;
  const raw = await ctx.call(
    `setElementAnnotation(${input.typeName}, ${codeArg})`,
  );
  return parseOutput(
    SetElementAnnotationOutputSchema,
    { success: expectBool(parse(raw)) },
    "setElementAnnotation",
  );
}
