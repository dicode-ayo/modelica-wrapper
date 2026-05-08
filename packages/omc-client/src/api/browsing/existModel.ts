/**
 * OMC: `function existModel = isModel`
 *
 * Alias for `isModel` declared in OMC's scripting API. Returns true iff `cl`
 * resolves to a `model` (not a block, package, function, etc.).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const ExistModelInputSchema = TypeNameInput;
export type ExistModelInput = z.input<typeof ExistModelInputSchema>;

export const ExistModelOutputSchema = BooleanBOutput;
export type ExistModelOutput = z.infer<typeof ExistModelOutputSchema>;

export async function existModel(
  ctx: CallContext,
  input: ExistModelInput,
): Promise<ExistModelOutput> {
  const raw = await ctx.call(`existModel(${input.typeName})`);
  return parseOutput(
    ExistModelOutputSchema,
    { b: expectBool(parse(raw)) },
    "existModel",
  );
}
