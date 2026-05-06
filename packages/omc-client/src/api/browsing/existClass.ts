/**
 * OMC: `function existClass`
 *
 * ```modelica
 * function existClass
 *   input TypeName cl;
 *   output Boolean exists;
 * end existClass;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const ExistClassInputSchema = TypeNameInput;
export type ExistClassInput = z.input<typeof ExistClassInputSchema>;

export const ExistClassOutputSchema = z.object({
  exists: z.boolean(),
});
export type ExistClassOutput = z.infer<typeof ExistClassOutputSchema>;

export async function existClass(
  ctx: CallContext,
  input: ExistClassInput,
): Promise<ExistClassOutput> {
  const raw = await ctx.call(`existClass(${input.typeName})`);
  return parseOutput(
    ExistClassOutputSchema,
    { exists: expectBool(parse(raw)) },
    "existClass",
  );
}
