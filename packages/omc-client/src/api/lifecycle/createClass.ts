/**
 * OMC: `function createClass`
 *
 * Create a new top-level class. `restriction` is one of "model", "block",
 * "package", "function", "connector", "type", "record", etc.
 *
 * @deprecated NOT AVAILABLE on OMC 1.26.x's interactive scripting (symbol
 *             not found; verified absent on both 1.26.1 and 1.26.7).
 *             Wrapper kept for forward/backward compatibility with OMC
 *             versions that expose it.
 *
 *             **Migration on 1.26.x**: build a Modelica source string in
 *             memory and load it with `loadString`:
 *
 *             ```ts
 *             await client.loadString({
 *               data: `model ${name}\nend ${name};`,
 *               filename: `<runtime:${name}>`,
 *             });
 *             ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const CreateClassInputSchema = z.object({
  typeName: z.string(),
  restriction: z.string(),
  partial: z.boolean().optional().default(false),
  encapsulated: z.boolean().optional().default(false),
});
export type CreateClassInput = z.input<typeof CreateClassInputSchema>;

export const CreateClassOutputSchema = SuccessOutput;
export type CreateClassOutput = z.infer<typeof CreateClassOutputSchema>;

export async function createClass(
  ctx: CallContext,
  input: CreateClassInput,
): Promise<CreateClassOutput> {
  const raw = await ctx.call(
    `createClass(${input.typeName}, ${quote(input.restriction)}, ${mlBool(input.partial ?? false)}, ${mlBool(input.encapsulated ?? false)})`,
  );
  return parseOutput(
    CreateClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "createClass") },
    "createClass",
  );
}
