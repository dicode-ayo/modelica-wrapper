/**
 * OMC: `function translateModelXML`
 *
 * Emit the XML description of the model. Returns the path to the generated file.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const TranslateModelXMLInputSchema = TypeNameInput;
export type TranslateModelXMLInput = z.input<
  typeof TranslateModelXMLInputSchema
>;

export const TranslateModelXMLOutputSchema = z.object({
  generatedFileName: z.string(),
});
export type TranslateModelXMLOutput = z.infer<
  typeof TranslateModelXMLOutputSchema
>;

export async function translateModelXML(
  ctx: CallContext,
  input: TranslateModelXMLInput,
): Promise<TranslateModelXMLOutput> {
  const raw = await ctx.call(`translateModelXML(${input.typeName})`);
  return parseOutput(
    TranslateModelXMLOutputSchema,
    { generatedFileName: expectString(parse(raw)) },
    "translateModelXML",
  );
}
