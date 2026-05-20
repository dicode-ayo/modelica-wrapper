/**
 * OMC: `function isShortDefinition`
 *
 * Returns true if the given class is defined as a short class definition,
 * e.g. `type T = Real;`.
 *
 * ```modelica
 * function isShortDefinition
 *   input TypeName class_;
 *   output Boolean isShortCls;
 * end isShortDefinition;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsShortDefinitionInputSchema = TypeNameInput;
export type IsShortDefinitionInput = z.input<
  typeof IsShortDefinitionInputSchema
>;

export const IsShortDefinitionOutputSchema = z.object({
  isShortCls: z
    .boolean()
    .describe(
      "True if the class is a short class definition (e.g. `type T = Real;`); field name `isShortCls` is OMC verbatim.",
    ),
});
export type IsShortDefinitionOutput = z.infer<
  typeof IsShortDefinitionOutputSchema
>;

export const IsShortDefinitionDescription =
  "Return true if the given class is defined as a short class definition.";

export async function isShortDefinition(
  ctx: CallContext,
  input: IsShortDefinitionInput,
): Promise<IsShortDefinitionOutput> {
  const raw = await ctx.call(`isShortDefinition(${input.typeName})`);
  return parseOutput(
    IsShortDefinitionOutputSchema,
    { isShortCls: expectBool(parse(raw)) },
    "isShortDefinition",
  );
}
