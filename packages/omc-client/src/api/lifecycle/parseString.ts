/**
 * OMC: `function parseString`
 *
 * Parse Modelica source text *without* loading it into the symbol table; return
 * the top-level class names declared inside.
 *
 * The non-mutation property is the whole point of `parseString`: unlike
 * `loadString`, it leaves OMC's class registry untouched, so live syntax
 * checking can run on every keystroke without polluting state visible to
 * subsequent `getClassNames`/`checkModel` calls.
 *
 * Diagnostics for malformed sources land in OMC's error buffer; the wrapper
 * itself does NOT throw on syntax errors — callers should drain
 * `getErrorString()` (or `getMessagesStringInternal()` for structured output)
 * after the call to detect them. On error OMC typically returns an empty list
 * or null, which this wrapper normalizes to `{ classNames: [] }`.
 *
 * OMC scripting reference:
 *   https://build.openmodelica.org/Documentation/OpenModelica.Scripting.parseString.html
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const ParseStringInputSchema = z.object({
  data: z.string().describe("Modelica source text to parse."),
  filename: z
    .string()
    .optional()
    .default("<interactive>")
    .describe(
      "Pseudo-filename echoed back in diagnostics; default `<interactive>`.",
    ),
});
export type ParseStringInput = z.input<typeof ParseStringInputSchema>;

export const ParseStringOutputSchema = z.object({
  classNames: z
    .array(z.string())
    .describe("Top-level class names declared in the parsed source."),
});
export type ParseStringOutput = z.infer<typeof ParseStringOutputSchema>;

export const ParseStringDescription =
  "Parse a Modelica source string and return the top-level class names declared in it WITHOUT loading them into OMC's symbol table — the right call for live syntax checks where polluting the loaded-class registry is unacceptable.";

export async function parseString(
  ctx: CallContext,
  input: ParseStringInput,
): Promise<ParseStringOutput> {
  const filename = input.filename ?? "<interactive>";
  const raw = await ctx.call(
    `parseString(${quote(input.data)}, ${quote(filename)})`,
  );
  return parseOutput(
    ParseStringOutputSchema,
    { classNames: expectStringList(parse(raw)) },
    "parseString",
  );
}
