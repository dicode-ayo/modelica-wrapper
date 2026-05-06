/**
 * OMC: `function getModelInstanceAnnotation`
 *
 * Returns the annotation-only subset of the structured model tree. Same
 * root shape as `getModelInstance`, but prunes subcomponent type definitions
 * — Icon/Diagram on the class itself and on direct `extends` are populated;
 * the deep type expansions used by full layout assembly are omitted. Useful
 * for thumbnails / icon previews where the diagram contents are irrelevant.
 *
 * ```modelica
 * function getModelInstanceAnnotation
 *   input TypeName className;
 *   input String[:] filter = fill("", 0);
 *   input Boolean prettyPrint = false;
 *   output String result;
 * end getModelInstanceAnnotation;
 * ```
 *
 * Like `getModelInstance`, OMC returns the JSON wrapped in a Modelica string
 * literal. We unwrap and `JSON.parse` it.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import {
  ModelInstanceAnnotationSchema,
  type ModelInstanceAnnotation,
} from "../../_shared/modelInstance.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetModelInstanceAnnotationInputSchema = TypeNameInput;
export type GetModelInstanceAnnotationInput = z.input<
  typeof GetModelInstanceAnnotationInputSchema
>;

export const GetModelInstanceAnnotationOutputSchema = z.object({
  instance: ModelInstanceAnnotationSchema,
});
export interface GetModelInstanceAnnotationOutput {
  instance: ModelInstanceAnnotation;
}

export const GetModelInstanceAnnotationDescription =
  "Return the annotation-only subset of the structured model tree (Icon/Diagram on the class and direct `extends`, with deep type expansions pruned). Useful for thumbnails and icon previews where diagram contents are irrelevant.";

export async function getModelInstanceAnnotation(
  ctx: CallContext,
  input: GetModelInstanceAnnotationInput,
): Promise<GetModelInstanceAnnotationOutput> {
  const raw = await ctx.call(`getModelInstanceAnnotation(${input.typeName})`);
  const json = expectString(parse(raw));
  const parsed: unknown = JSON.parse(json);
  const validated = parseOutput(
    GetModelInstanceAnnotationOutputSchema,
    { instance: parsed },
    "getModelInstanceAnnotation",
  );
  return {
    instance: validated.instance as ModelInstanceAnnotation,
  };
}
