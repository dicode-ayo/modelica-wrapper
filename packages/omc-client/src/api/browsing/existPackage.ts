/**
 * OMC: `function existPackage = isPackage`
 *
 * Alias for `isPackage` declared in OMC's scripting API.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { BooleanBOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const ExistPackageInputSchema = TypeNameInput;
export type ExistPackageInput = z.input<typeof ExistPackageInputSchema>;

export const ExistPackageOutputSchema = BooleanBOutput;
export type ExistPackageOutput = z.infer<typeof ExistPackageOutputSchema>;

export const ExistPackageDescription =
  "Alias for `isPackage`: report whether the given class resolves to a `package` restriction.";

export async function existPackage(
  ctx: CallContext,
  input: ExistPackageInput,
): Promise<ExistPackageOutput> {
  const raw = await ctx.call(`existPackage(${input.typeName})`);
  return parseOutput(
    ExistPackageOutputSchema,
    { b: expectBool(parse(raw)) },
    "existPackage",
  );
}
