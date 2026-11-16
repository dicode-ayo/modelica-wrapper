/**
 * Evaluate a fully qualified constant (`Modelica.Constants.eps`) to its value.
 *
 * Not an OMC scripting function: the command is the bare reference itself,
 * which OMC's interactive evaluator reduces to a literal — the way OMEdit's
 * `OMCProxy::evaluateConstant` reads one. A name outside
 * `CONSTANT_REFERENCE` is refused before it reaches OMC.
 *
 * Only a scalar literal reply counts as a value. An enumeration constant comes
 * back as a bare dotted name, indistinguishable from OMC echoing a reference
 * it could not reduce, so it is a failure here too.
 *
 * The lookup can make OMC load a library from MODELICAPATH when the name's
 * top-level class is not loaded yet. A caller that must not change the
 * session checks the head against the loaded classes first, as
 * `resolveEnableConstants` does.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { constantName } from "../../_shared/fields.js";
import { parseOutput, readFailure } from "../../_shared/parseOutput.js";
import { constantReference } from "../../commands.js";
import { OmcDiagnosticError } from "../../error-buffer.js";
import { parse, type Value } from "../../parse.js";

export const EvaluateConstantInputSchema = z.strictObject({
  name: constantName.describe(
    "Fully qualified name of the constant to evaluate.",
  ),
});
export type EvaluateConstantInput = z.input<typeof EvaluateConstantInputSchema>;

export const EvaluateConstantOutputSchema = z.object({
  value: z
    .union([z.number(), z.boolean(), z.string()])
    .describe("The constant's value as a Real/Integer, Boolean or String."),
});
export type EvaluateConstantOutput = z.infer<
  typeof EvaluateConstantOutputSchema
>;

export const EvaluateConstantDescription =
  "Evaluate a fully qualified constant (e.g. Modelica.Constants.eps) to its scalar literal value.";

export async function evaluateConstant(
  ctx: CallContext,
  input: EvaluateConstantInput,
): Promise<EvaluateConstantOutput> {
  const cmd = constantReference(input.name);
  if (cmd === undefined) {
    throw new Error(
      `evaluateConstant: not a constant reference: ${input.name}`,
    );
  }
  const value = scalarLiteral(await ctx.call(cmd));
  // A failed lookup leaves its diagnostic behind; readFailure drains it.
  if (value === undefined) throw await readFailure(ctx, "evaluateConstant");
  return parseOutput(
    EvaluateConstantOutputSchema,
    { value },
    "evaluateConstant",
  );
}

function scalarLiteral(raw: string): number | boolean | string | undefined {
  let v: Value;
  try {
    v = parse(raw);
  } catch (err) {
    // OMC reported the failure inline, so the error buffer holds nothing.
    if (err instanceof OmcDiagnosticError) throw err;
    return undefined;
  }
  switch (v.kind) {
    case "bool":
    case "int":
    case "float":
    case "string":
      return v.value;
    default:
      return undefined;
  }
}
