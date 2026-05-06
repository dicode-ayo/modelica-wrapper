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
  before: z.string(),
  after: z.string(),
  kind: z.enum(["plain", "color"]).optional().default("plain"),
});
export type DiffModelicaFileListingsInput = z.input<
  typeof DiffModelicaFileListingsInputSchema
>;

export const DiffModelicaFileListingsOutputSchema = z.object({
  diff: z.string(),
});
export type DiffModelicaFileListingsOutput = z.infer<
  typeof DiffModelicaFileListingsOutputSchema
>;

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
