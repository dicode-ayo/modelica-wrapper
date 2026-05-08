/**
 * OMC: `function diffModelicaFileListings`
 *
 * Diff two Modelica source listings. `kind` is "plain" or "color".
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const DiffModelicaFileListingsInputSchema = z.object({
  before: z.string().describe("Modelica source listing before the change."),
  after: z.string().describe("Modelica source listing after the change."),
  kind: z.enum(["plain", "color"]).optional().default("plain").describe('Output format: "plain" yields the final text (deletions removed); "color" yields terminal color codes.'),
});
export type DiffModelicaFileListingsInput = z.input<
  typeof DiffModelicaFileListingsInputSchema
>;

export const DiffModelicaFileListingsOutputSchema = z.object({
  diff: z.string().describe("Diff text rendered in the requested format."),
});
export type DiffModelicaFileListingsOutput = z.infer<
  typeof DiffModelicaFileListingsOutputSchema
>;

export const DiffModelicaFileListingsDescription =
  "Create a diff of two Modelica source listings, tolerant of comment-reordering and whitespace differences introduced by the OMC list API.";

export async function diffModelicaFileListings(
  ctx: CallContext,
  input: DiffModelicaFileListingsInput,
): Promise<DiffModelicaFileListingsOutput> {
  const kind = input.kind ?? "plain";
  const raw = await ctx.call(
    `diffModelicaFileListings(${quote(input.before)}, ${quote(input.after)}, OpenModelica.Scripting.DiffFormat.${kind})`,
  );
  return parseOutput(
    DiffModelicaFileListingsOutputSchema,
    { diff: expectString(parse(raw)) },
    "diffModelicaFileListings",
  );
}
