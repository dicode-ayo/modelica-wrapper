/**
 * OMC: `function getDerivedUnits`
 *
 * Enumerate the units derived from a given base unit — the companion call to
 * `convertUnits` that populates the parameter editor's unit dropdown (OMEdit
 * `OMCProxy::getDerivedUnits`, `ElementProperties.cpp`). With the list of
 * derived units in hand the caller offers each as a `displayUnit` choice and
 * uses `convertUnits(baseUnit, choice)` to render the value.
 *
 * ```modelica
 * function getDerivedUnits
 *   input String baseUnit;
 *   output String[:] derivedUnits;
 * end getDerivedUnits;
 * ```
 *
 * Verified live on OMC 1.26.7 (Modelica loaded):
 *   - `getDerivedUnits("K")` → `{"degC", "degF", "degRk"}`
 *   - `getDerivedUnits("1")` → `{}` (no derived units for the unit-less base)
 *
 * `baseUnit` is a `String` arg and MUST be quoted — OMC otherwise tries to
 * resolve a bare ident as a name in scope (see audit.md §2.10). An unknown
 * base unit returns an empty list rather than an error.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { quote } from "../../_shared/format.js";
import { expectStringList, parse } from "../../parse.js";

export const GetDerivedUnitsInputSchema = z.object({
  baseUnit: z
    .string()
    .describe('Base unit string whose derived units to enumerate (e.g. "K").'),
});
export type GetDerivedUnitsInput = z.input<typeof GetDerivedUnitsInputSchema>;

export const GetDerivedUnitsOutputSchema = z.object({
  derivedUnits: z
    .array(z.string())
    .describe("Units derived from the base unit; empty if none/unknown."),
});
export type GetDerivedUnitsOutput = z.infer<typeof GetDerivedUnitsOutputSchema>;

export const GetDerivedUnitsDescription =
  "Return the list of derived units for the specified base unit.";

export async function getDerivedUnits(
  ctx: CallContext,
  input: GetDerivedUnitsInput,
): Promise<GetDerivedUnitsOutput> {
  const raw = await ctx.call(`getDerivedUnits(${quote(input.baseUnit)})`);
  return parseOutput(
    GetDerivedUnitsOutputSchema,
    { derivedUnits: expectStringList(parse(raw)) },
    "getDerivedUnits",
  );
}
