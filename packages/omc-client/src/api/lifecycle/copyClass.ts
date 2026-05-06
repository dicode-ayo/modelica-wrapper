/**
 * OMC: `function copyClass`
 *
 * ```modelica
 * function copyClass
 *   input TypeName className "the class that should be copied";
 *   input String newClassName "the name for new class";
 *   input TypeName withIn = $Code(__OpenModelica_TopLevel) "the within path for new class";
 *   output Boolean result;
 * end copyClass;
 * ```
 *
 * Note the asymmetry: `className` is a TypeName (bare), `newClassName` is a
 * String (quoted), `withIn` is a TypeName again (bare).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import type { OmcCommand } from "../../commands.js";
import { quote } from "../../_shared/format.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const CopyClassInputSchema = z.object({
  source: z.string(),
  destination: z.string(),
  within: z.string().optional().default(""),
});
export type CopyClassInput = z.input<typeof CopyClassInputSchema>;

export const CopyClassOutputSchema = z.object({
  result: z.boolean(),
});
export type CopyClassOutput = z.infer<typeof CopyClassOutputSchema>;

export async function copyClass(
  ctx: CallContext,
  input: CopyClassInput,
): Promise<CopyClassOutput> {
  const within = input.within ?? "";
  const cmd: OmcCommand =
    within === ""
      ? `copyClass(${input.source}, ${quote(input.destination)})`
      : `copyClass(${input.source}, ${quote(input.destination)}, ${within})`;
  const raw = await ctx.call(cmd);
  return parseOutput(
    CopyClassOutputSchema,
    { result: await parseMutationSuccess(ctx, raw, "copyClass") },
    "copyClass",
  );
}
