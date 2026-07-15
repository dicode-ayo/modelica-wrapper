/**
 * OMC: `function getModelInstance`
 *
 * Returns the entire elaborated model AST as a structured JSON tree —
 * annotations preserved, inheritance auto-walked, sub-component types
 * expanded, connections tagged with `cref` paths and `Line.points`. One call
 * replaces the multi-call assembly of `getIcon/Diagram/Components/
 * ComponentAnnotations/NthConnection*` plus the per-base-class inheritance
 * walk and per-subcomponent type lookup (~30+ round-trips → 1).
 *
 * ```modelica
 * function getModelInstance
 *   input TypeName className;
 *   input String modifier = "";
 *   input Boolean prettyPrint = false;
 *   output String result;
 * end getModelInstance;
 * ```
 *
 * OMC wraps the JSON in a single Modelica string literal; we unwrap and
 * `JSON.parse` it. `prettyPrint=true` returns the same content indented
 * (~3x bytes) — useful for fixture capture / debug, not for production.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { prettyPrint } from "../../_shared/fields.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import {
  ModelInstanceSchema,
  parseModelInstanceOutput,
  type ModelInstance,
} from "../../_shared/modelInstance.js";
import { expectString, parse } from "../../parse.js";

export const GetModelInstanceInputSchema = TypeNameInput.extend({
  prettyPrint,
});
export type GetModelInstanceInput = z.input<typeof GetModelInstanceInputSchema>;

export const GetModelInstanceOutputSchema = z.object({
  instance: ModelInstanceSchema,
});
export interface GetModelInstanceOutput {
  instance: ModelInstance;
}

export const GetModelInstanceDescription =
  "Return the entire elaborated model AST as a structured JSON tree — annotations preserved, inheritance auto-walked, sub-component types expanded, connections tagged with `cref` paths and `Line.points`. Replaces ~30+ round-trips (getIcon/Diagram/Components/ComponentAnnotations/NthConnection* plus per-base-class inheritance walk) with one call.";

export async function getModelInstance(
  ctx: CallContext,
  input: GetModelInstanceInput,
): Promise<GetModelInstanceOutput> {
  const args =
    input.prettyPrint === true
      ? `${input.typeName}, prettyPrint=true`
      : `${input.typeName}`;
  const raw = await ctx.call(`getModelInstance(${args})`);
  const json = expectString(parse(raw));
  const parsed: unknown = JSON.parse(json);
  const validated = parseModelInstanceOutput(
    GetModelInstanceOutputSchema,
    { instance: parsed },
    "getModelInstance",
    input.typeName,
  );
  return { instance: validated.instance };
}
