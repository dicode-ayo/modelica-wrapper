/**
 * OMC: `function isPackage`
 *
 * ```modelica
 * function isPackage
 *   input TypeName cl;
 *   output Boolean b;
 * end isPackage;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsPackageInputSchema = TypeNameInput;
export type IsPackageInput = z.input<typeof IsPackageInputSchema>;

export const IsPackageOutputSchema = BooleanBOutput;
export type IsPackageOutput = z.infer<typeof IsPackageOutputSchema>;

export async function isPackage(
  ctx: CallContext,
  input: IsPackageInput,
): Promise<IsPackageOutput> {
  const raw = await ctx.call(`isPackage(${input.typeName})`);
  return parseOutput(
    IsPackageOutputSchema,
    { b: expectBool(parse(raw)) },
    "isPackage",
  );
}
