/**
 * OMC: `function isConstant`
 *
 * Checks whether a component in a class is declared `constant`.
 *
 * ```modelica
 * function isConstant
 *   input TypeName componentName;
 *   input TypeName className;
 *   output Boolean result;
 * end isConstant;
 * ```
 *
 * Both arguments are TypeNames (emitted bare). Per audit.md §2.3 the primary
 * class TypeName (`className`) is exposed as `typeName`; the secondary TypeName
 * (`componentName`) keeps its OMC name. OMC's argument order is
 * `(componentName, className)`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { BooleanResultOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsConstantInputSchema = TypeNameAndComponentNameInput;
export type IsConstantInput = z.input<typeof IsConstantInputSchema>;

export const IsConstantOutputSchema = BooleanResultOutput;
export type IsConstantOutput = z.infer<typeof IsConstantOutputSchema>;

export const IsConstantDescription =
  "Check whether a component in a class is declared `constant`.";

export async function isConstant(
  ctx: CallContext,
  input: IsConstantInput,
): Promise<IsConstantOutput> {
  const raw = await ctx.call(
    `isConstant(${input.componentName}, ${input.typeName})`,
  );
  return parseOutput(
    IsConstantOutputSchema,
    { result: expectBool(parse(raw)) },
    "isConstant",
  );
}
