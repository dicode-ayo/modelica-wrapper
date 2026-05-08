/**
 * OMC: `function createSubClass`
 *
 * Create a class nested inside `parent`.
 *
 * @deprecated NOT AVAILABLE on OMC 1.26.x's interactive scripting (symbol
 *             not found; verified absent on both 1.26.1 and 1.26.7).
 *             Wrapper kept for forward/backward compatibility.
 *             **Migration on 1.26.x**: use `loadString` with a package body:
 *
 *             ```ts
 *             await client.loadString({
 *               data: `within ${parent};\nmodel ${name}\nend ${name};`,
 *               filename: `<runtime:${parent}.${name}>`,
 *             });
 *             ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const CreateSubClassInputSchema = z.object({
  typeName: z.string(),
  parent: z.string(),
  restriction: z.string(),
  partial: z.boolean().optional().default(false),
  encapsulated: z.boolean().optional().default(false),
});
export type CreateSubClassInput = z.input<typeof CreateSubClassInputSchema>;

export const CreateSubClassOutputSchema = SuccessOutput;
export type CreateSubClassOutput = z.infer<typeof CreateSubClassOutputSchema>;

export async function createSubClass(
  ctx: CallContext,
  input: CreateSubClassInput,
): Promise<CreateSubClassOutput> {
  const raw = await ctx.call(
    `createSubClass(${input.typeName}, ${input.parent}, ${quote(input.restriction)}, ${mlBool(input.partial ?? false)}, ${mlBool(input.encapsulated ?? false)})`,
  );
  return parseOutput(
    CreateSubClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "createSubClass") },
    "createSubClass",
  );
}
