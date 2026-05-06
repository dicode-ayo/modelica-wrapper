/**
 * OMC: `function copyClass`
 *
 * Duplicate `source` as a new class at `within` (or top-level if within is "").
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import type { OmcCommand } from "../../commands.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const CopyClassInputSchema = z.object({
  source: z.string(),
  destination: z.string(),
  within: z.string().optional().default(""),
});
export type CopyClassInput = z.input<typeof CopyClassInputSchema>;

export const CopyClassOutputSchema = z.object({
  success: z.boolean(),
});
export type CopyClassOutput = z.infer<typeof CopyClassOutputSchema>;

export async function copyClass(
  ctx: CallContext,
  input: CopyClassInput,
): Promise<CopyClassOutput> {
  const within = input.within ?? "";
  const cmd: OmcCommand =
    within === ""
      ? `copyClass(${input.source}, ${input.destination})`
      : `copyClass(${input.source}, ${input.destination}, ${within})`;
  const raw = await ctx.call(cmd);
  return parseOutput(
    CopyClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "copyClass") },
    "copyClass",
  );
}
