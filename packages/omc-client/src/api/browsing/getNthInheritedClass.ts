/**
 * OMC: `function getNthInheritedClass`
 *
 * Returns the name of the n:th inherited (via `extends`) class in the given
 * class. This is the indexed counterpart to the bulk `getInheritedClasses`.
 *
 * ```modelica
 * function getNthInheritedClass
 *   input TypeName className;
 *   input Integer n;
 *   output TypeName baseClass;
 * end getNthInheritedClass;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndIndexInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetNthInheritedClassInputSchema = TypeNameAndIndexInput;
export type GetNthInheritedClassInput = z.input<
  typeof GetNthInheritedClassInputSchema
>;

export const GetNthInheritedClassOutputSchema = z.object({
  baseClass: z
    .string()
    .describe(
      "Fully qualified TypeName of the n:th inherited class; field name `baseClass` is OMC verbatim.",
    ),
});
export type GetNthInheritedClassOutput = z.infer<
  typeof GetNthInheritedClassOutputSchema
>;

export const GetNthInheritedClassDescription =
  "Return the name of the n:th inherited class in the given class.";

export async function getNthInheritedClass(
  ctx: CallContext,
  input: GetNthInheritedClassInput,
): Promise<GetNthInheritedClassOutput> {
  const raw = await ctx.call(
    `getNthInheritedClass(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthInheritedClassOutputSchema,
    { baseClass: expectString(parse(raw)) },
    "getNthInheritedClass",
  );
}
