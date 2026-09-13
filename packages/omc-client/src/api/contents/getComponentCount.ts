/**
 * OMC: `function getComponentCount`
 *
 * Returns the number of components declared in a class.
 *
 * ```modelica
 * function getComponentCount
 *   input TypeName classPath;
 *   output Integer count;
 * end getComponentCount;
 * ```
 *
 * Pairs with `getNthComponent(typeName, n)` for 1-based indexed iteration.
 * For most read use-cases the structured `getModelInstance` AST is richer.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetComponentCountInputSchema = TypeNameInput;
export type GetComponentCountInput = z.input<
  typeof GetComponentCountInputSchema
>;

export const GetComponentCountOutputSchema = z.object({
  count: z
    .number()
    .int()
    .describe("Number of components declared in the class."),
});
export type GetComponentCountOutput = z.infer<
  typeof GetComponentCountOutputSchema
>;

export const GetComponentCountDescription =
  "Count the number of components declared in a class. Pairs with `getNthComponent`; consider `getModelInstance` for a richer structured read.";

export async function getComponentCount(
  ctx: CallContext,
  input: GetComponentCountInput,
): Promise<GetComponentCountOutput> {
  const raw = await ctx.call(`getComponentCount(${input.typeName})`);
  return parseOutput(
    GetComponentCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getComponentCount",
  );
}
