/**
 * OMC: `function translateModel`
 *
 * Run OMC's frontend + backend, generating C code for the class.
 * Use OmcClient.setCallTimeout() for large models.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const TranslateModelInputSchema = TypeNameInput;
export type TranslateModelInput = z.input<typeof TranslateModelInputSchema>;

export const TranslateModelOutputSchema = SuccessOutput;
export type TranslateModelOutput = z.infer<typeof TranslateModelOutputSchema>;

export const TranslateModelDescription = "Translate a Modelica model into C code without building it.";

export async function translateModel(
  ctx: CallContext,
  input: TranslateModelInput,
): Promise<TranslateModelOutput> {
  const raw = await ctx.call(`translateModel(${input.typeName})`);
  return parseOutput(
    TranslateModelOutputSchema,
    { success: expectBool(parse(raw)) },
    "translateModel",
  );
}
