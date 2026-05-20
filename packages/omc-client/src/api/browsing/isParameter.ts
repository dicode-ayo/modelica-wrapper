/**
 * OMC: `function isParameter`
 *
 * Checks whether a component in a class is declared `parameter`.
 *
 * ```modelica
 * function isParameter
 *   input TypeName componentName;
 *   input TypeName className;
 *   output Boolean result;
 * end isParameter;
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

export const IsParameterInputSchema = TypeNameAndComponentNameInput;
export type IsParameterInput = z.input<typeof IsParameterInputSchema>;

export const IsParameterOutputSchema = BooleanResultOutput;
export type IsParameterOutput = z.infer<typeof IsParameterOutputSchema>;

export const IsParameterDescription =
  "Check whether a component in a class is declared `parameter`.";

export async function isParameter(
  ctx: CallContext,
  input: IsParameterInput,
): Promise<IsParameterOutput> {
  const raw = await ctx.call(
    `isParameter(${input.componentName}, ${input.typeName})`,
  );
  return parseOutput(
    IsParameterOutputSchema,
    { result: expectBool(parse(raw)) },
    "isParameter",
  );
}
