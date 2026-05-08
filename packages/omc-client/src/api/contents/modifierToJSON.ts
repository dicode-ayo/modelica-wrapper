/**
 * OMC: `function modifierToJSON`
 *
 * ```modelica
 * function modifierToJSON
 *   input String modifier;
 *   input Boolean prettyPrint = false;
 *   output String json;
 * end modifierToJSON;
 * ```
 *
 * Converts a Modelica modifier expression string into its JSON form. The
 * wrapper does not parse the JSON; callers `JSON.parse(json)` themselves.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const ModifierToJSONInputSchema = z.object({
  modifier: z.string().describe("Raw Modelica modifier expression to convert."),
  prettyPrint: z.boolean().optional().default(false).describe("Indent the JSON output for human readability when true."),
});
export type ModifierToJSONInput = z.input<typeof ModifierToJSONInputSchema>;

export const ModifierToJSONOutputSchema = z.object({
  json: z.string().describe("JSON encoding of the modifier expression; field name `json` is OMC verbatim."),
});
export type ModifierToJSONOutput = z.infer<typeof ModifierToJSONOutputSchema>;

export const ModifierToJSONDescription =
  "Convert a Modelica modifier expression string into its JSON form; the wrapper does not parse the JSON, callers `JSON.parse(json)` themselves.";

export async function modifierToJSON(
  ctx: CallContext,
  input: ModifierToJSONInput,
): Promise<ModifierToJSONOutput> {
  const prettyPrint = input.prettyPrint ?? false;
  const raw = await ctx.call(
    `modifierToJSON(${quote(input.modifier)}, ${mlBool(prettyPrint)})`,
  );
  return parseOutput(
    ModifierToJSONOutputSchema,
    { json: asString(parse(raw)) ?? "" },
    "modifierToJSON",
  );
}
