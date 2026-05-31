/**
 * OMC: `function parseFile`
 *
 * Parse a `.mo` file without loading it into the symbol table; return the
 * top-level class names declared inside.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const ParseFileInputSchema = z.object({
  fileName: z.string().describe("Path to the `.mo` Modelica file to parse."),
  encoding: z
    .string()
    .optional()
    .default("UTF-8")
    .describe("Text encoding of the file (default UTF-8)."),
});
export type ParseFileInput = z.input<typeof ParseFileInputSchema>;

export const ParseFileOutputSchema = z.object({
  classNames: z
    .array(z.string())
    .describe("Top-level class names declared in the file."),
});
export type ParseFileOutput = z.infer<typeof ParseFileOutputSchema>;

export const ParseFileDescription =
  "Parse a Modelica file and return the top-level class names declared in it (without loading into the symbol table).";

export async function parseFile(
  ctx: CallContext,
  input: ParseFileInput,
): Promise<ParseFileOutput> {
  const raw = await ctx.call(
    `parseFile(${quote(input.fileName)}, ${quote(input.encoding ?? "UTF-8")})`,
  );
  return parseOutput(
    ParseFileOutputSchema,
    { classNames: expectStringList(parse(raw)) },
    "parseFile",
  );
}
