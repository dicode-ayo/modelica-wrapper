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
  fileName: z.string(),
  encoding: z.string().optional().default("UTF-8"),
});
export type ParseFileInput = z.input<typeof ParseFileInputSchema>;

export const ParseFileOutputSchema = z.object({
  classNames: z.array(z.string()),
});
export type ParseFileOutput = z.infer<typeof ParseFileOutputSchema>;

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
