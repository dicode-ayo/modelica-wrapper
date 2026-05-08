/**
 * OMC: `function setElementType`
 *
 * ```modelica
 * function setElementType
 *   input TypeName elementName;
 *   input VariableName typeName;
 *   output Boolean success;
 * end setElementType;
 * ```
 *
 * Convention divergence: OMC's first arg (`TypeName elementName`) maps to our
 * `typeName` (per the package-wide TypeName-rename rule); OMC's second arg
 * (`VariableName typeName`) is renamed `newTypeName` to avoid collision.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetElementTypeInputSchema = z.object({
  typeName: z.string().describe("Dotted element path within the class (OMC `elementName`, mapped to `typeName` per the package convention)."),
  newTypeName: z.string().describe("New type to assign to the element (OMC `typeName`, renamed to avoid collision with the package-wide TypeName-rename)."),
});
export type SetElementTypeInput = z.input<typeof SetElementTypeInputSchema>;

export const SetElementTypeOutputSchema = SuccessOutput;
export type SetElementTypeOutput = z.infer<typeof SetElementTypeOutputSchema>;

export const SetElementTypeDescription = "Change the declared type of an element to a new TypeName.";

export async function setElementType(
  ctx: CallContext,
  input: SetElementTypeInput,
): Promise<SetElementTypeOutput> {
  const raw = await ctx.call(
    `setElementType(${input.typeName}, ${input.newTypeName})`,
  );
  return parseOutput(
    SetElementTypeOutputSchema,
    { success: expectBool(parse(raw)) },
    "setElementType",
  );
}
