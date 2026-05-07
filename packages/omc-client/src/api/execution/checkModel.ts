/**
 * OMC: `function checkModel`
 *
 * Run a syntactic + semantic check. Returns a diagnostic text (success
 * messages or compiler errors as one string).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { StringResultOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const CheckModelInputSchema = TypeNameInput;
export type CheckModelInput = z.input<typeof CheckModelInputSchema>;

export const CheckModelOutputSchema = StringResultOutput;
export type CheckModelOutput = z.infer<typeof CheckModelOutputSchema>;

export async function checkModel(
  ctx: CallContext,
  input: CheckModelInput,
): Promise<CheckModelOutput> {
  const raw = await ctx.call(`checkModel(${input.typeName})`);
  return parseOutput(
    CheckModelOutputSchema,
    { result: expectString(parse(raw)) },
    "checkModel",
  );
}
