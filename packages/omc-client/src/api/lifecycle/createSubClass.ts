/**
 * OMC: `function createSubClass`
 *
 * Create a class nested inside `parent`.
 *
 * @deprecated NOT AVAILABLE on OMC 1.26.x's interactive scripting (symbol
 *             not found; verified absent on both 1.26.1 and 1.26.7).
 *             Wrapper kept for forward/backward compatibility.
 *
 *             **Migration on 1.26.x**: this is exactly what {@link newModel}
 *             does — create an empty `model` nested inside an existing package
 *             (verified working on 1.26.7):
 *
 *             ```ts
 *             await client.newModel({ typeName: name, withinPath: parent });
 *             ```
 *
 *             For a non-`model` restriction (block, package, record, …), fall
 *             back to `loadString` with a `within` clause (newModel has no
 *             restriction argument):
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
  typeName: z.string().describe("Local name to give the new sub-class."),
  parent: z.string().describe("TypeName of the existing parent class to nest the new class inside."),
  restriction: z.string().describe('Class restriction kind: "model", "block", "package", "function", "connector", "type", "record", …'),
  partial: z.boolean().optional().default(false).describe("Declare the class as `partial`."),
  encapsulated: z.boolean().optional().default(false).describe("Declare the class as `encapsulated`."),
});
export type CreateSubClassInput = z.input<typeof CreateSubClassInputSchema>;

export const CreateSubClassOutputSchema = SuccessOutput;
export type CreateSubClassOutput = z.infer<typeof CreateSubClassOutputSchema>;

export const CreateSubClassDescription =
  "Create a class nested inside an existing parent class. (OMC docs page is 404; symbol absent on OMC 1.26.x — see file docstring for migration.)";

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
