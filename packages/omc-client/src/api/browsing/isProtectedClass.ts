/**
 * OMC: `function isProtectedClass`
 *
 * ```modelica
 * function isProtectedClass
 *   input TypeName cl;
 *   input String c2;
 *   output Boolean b;
 * end isProtectedClass;
 * ```
 *
 * Checks whether the child class named `c2` inside `cl` is declared protected.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsProtectedClassInputSchema = z.object({
  typeName: z.string(),
  c2: z
    .string()
    .describe("Local name of the child class to check inside `typeName`."),
});
export type IsProtectedClassInput = z.input<typeof IsProtectedClassInputSchema>;

export const IsProtectedClassOutputSchema = BooleanBOutput;
export type IsProtectedClassOutput = z.infer<
  typeof IsProtectedClassOutputSchema
>;

export const IsProtectedClassDescription =
  "Check whether the child class `c2` inside the given class is declared in a protected section.";

export async function isProtectedClass(
  ctx: CallContext,
  input: IsProtectedClassInput,
): Promise<IsProtectedClassOutput> {
  const raw = await ctx.call(
    `isProtectedClass(${input.typeName}, ${quote(input.c2)})`,
  );
  return parseOutput(
    IsProtectedClassOutputSchema,
    { b: expectBool(parse(raw)) },
    "isProtectedClass",
  );
}
