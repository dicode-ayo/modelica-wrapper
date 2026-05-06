/**
 * OMC: `function getInheritedClasses`
 *
 * ```modelica
 * function getInheritedClasses
 *   input TypeName name;
 *   output TypeName inheritedClasses[:];
 * end getInheritedClasses;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetInheritedClassesInputSchema = TypeNameInput;
export type GetInheritedClassesInput = z.input<
  typeof GetInheritedClassesInputSchema
>;

export const GetInheritedClassesOutputSchema = z.object({
  inheritedClasses: z.array(z.string()),
});
export type GetInheritedClassesOutput = z.infer<
  typeof GetInheritedClassesOutputSchema
>;

export async function getInheritedClasses(
  ctx: CallContext,
  input: GetInheritedClassesInput,
): Promise<GetInheritedClassesOutput> {
  const raw = await ctx.call(`getInheritedClasses(${input.typeName})`);
  return parseOutput(
    GetInheritedClassesOutputSchema,
    { inheritedClasses: expectStringList(parse(raw)) },
    "getInheritedClasses",
  );
}
