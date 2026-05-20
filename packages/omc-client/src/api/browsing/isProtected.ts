/**
 * OMC: `function isProtected`
 *
 * Checks whether a component in a class is declared in a protected section.
 *
 * ```modelica
 * function isProtected
 *   input TypeName componentName;
 *   input TypeName className;
 *   output Boolean result;
 * end isProtected;
 * ```
 *
 * Both arguments are TypeNames (emitted bare). Per audit.md §2.3 the primary
 * class TypeName (`className`) is exposed as `typeName`; the secondary TypeName
 * (`componentName`) keeps its OMC name. OMC's argument order is
 * `(componentName, className)`. Distinct from `isProtectedClass`, which tests a
 * nested *class* named by a `String`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { BooleanResultOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsProtectedInputSchema = TypeNameAndComponentNameInput;
export type IsProtectedInput = z.input<typeof IsProtectedInputSchema>;

export const IsProtectedOutputSchema = BooleanResultOutput;
export type IsProtectedOutput = z.infer<typeof IsProtectedOutputSchema>;

export const IsProtectedDescription =
  "Check whether a component in a class is declared in a protected section.";

export async function isProtected(
  ctx: CallContext,
  input: IsProtectedInput,
): Promise<IsProtectedOutput> {
  const raw = await ctx.call(
    `isProtected(${input.componentName}, ${input.typeName})`,
  );
  return parseOutput(
    IsProtectedOutputSchema,
    { result: expectBool(parse(raw)) },
    "isProtected",
  );
}
