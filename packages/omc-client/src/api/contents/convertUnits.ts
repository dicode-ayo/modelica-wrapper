/**
 * OMC: `function convertUnits`
 *
 * Compute the affine conversion between two Modelica unit strings — used to
 * render a parameter in its `displayUnit` before substituting it into a
 * label.
 *
 * ```modelica
 * function convertUnits
 *   input String s1;
 *   input String s2;
 *   output Boolean unitsCompatible;
 *   output Real scaleFactor;
 *   output Real offset;
 * end convertUnits;
 * ```
 *
 * Conversion direction (how OMEdit uses it — `TextAnnotation.cpp:706`):
 * call `convertUnits(unit, displayUnit)`, i.e. `s1 = unit`, `s2 = displayUnit`.
 * The displayed value is then recovered as
 *
 *   `displayValue = (sourceValue - offset) / scaleFactor`
 *
 * (`Utilities::convertUnit(value, offset, scaleFactor)`). So for a
 * `1.57 rad` value with `displayUnit = "deg"`,
 * `convertUnits("rad", "deg") = (true, 0.0174…, 0.0)` and
 * `(1.57 - 0) / 0.0174… = 90`.
 *
 * Verified live on OMC 1.26.7 (results identical with or without MSL loaded):
 *   - `convertUnits("rad", "deg")` → `(true, 0.017453292519943295, 0.0)`
 *   - `convertUnits("deg", "rad")` → `(true, 57.29577951308232, 0.0)`
 *   - `convertUnits("degC", "K")`  → `(true, 1.0, -273.15)`
 *   - `convertUnits("m", "kg")`    → `(false, 1.0, 0.0)` (incompatible)
 *   - `convertUnits("", "rad")`    → `(false, 1.0, 0.0)` (empty unit)
 *
 * When `unitsCompatible` is `false` (incompatible or unknown units) the
 * scale/offset default to `1.0`/`0.0`; callers should treat a `false`
 * verdict as "render the source value unchanged".
 *
 * Both `s1` and `s2` are `String` args and MUST be quoted — OMC otherwise
 * tries to resolve a bare ident as a name in scope (see audit.md §2.10).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { quote } from "../../_shared/format.js";
import { asBool, asFloat, asList, parseLeading } from "../../parse.js";

export const ConvertUnitsInputSchema = z.object({
  s1: z
    .string()
    .describe("First unit string; OMEdit passes the declaration unit here (e.g. \"rad\")."),
  s2: z
    .string()
    .describe("Second unit string; OMEdit passes the displayUnit here (e.g. \"deg\")."),
});
export type ConvertUnitsInput = z.input<typeof ConvertUnitsInputSchema>;

export const ConvertUnitsOutputSchema = z.object({
  unitsCompatible: z
    .boolean()
    .describe("True if the two units are dimensionally compatible and convertible."),
  scaleFactor: z
    .number()
    .describe("Scale factor; displayed value is `(sourceValue - offset) / scaleFactor`. 1.0 when incompatible."),
  offset: z
    .number()
    .describe("Offset; displayed value is `(sourceValue - offset) / scaleFactor`. 0.0 when incompatible."),
});
export type ConvertUnitsOutput = z.infer<typeof ConvertUnitsOutputSchema>;

export const ConvertUnitsDescription =
  "Return the affine conversion (compatibility flag, scale factor, offset) from unit string s1 to unit string s2.";

export async function convertUnits(
  ctx: CallContext,
  input: ConvertUnitsInput,
): Promise<ConvertUnitsOutput> {
  const raw = await ctx.call(
    `convertUnits(${quote(input.s1)}, ${quote(input.s2)})`,
  );
  // OMC emits `(unitsCompatible, scaleFactor, offset)`; the paren tuple
  // parses as a list. Use `parseLeading` (tolerant of a trailing
  // diagnostic line) + `asList` (returns undefined rather than throwing on
  // a non-list) so an off-spec response — an error string, a bare value, a
  // short tuple — falls back to the documented neutral "(false, 1, 0)"
  // transform instead of throwing an unhandled exception at the call site
  // (issue #76, item 12).
  const items = asList(parseLeading(raw).value) ?? [];
  const [b, s, o] = items;
  const unitsCompatible = (b && asBool(b)) ?? false;
  const scaleFactor = (s && asFloat(s)) ?? 1.0;
  const offset = (o && asFloat(o)) ?? 0.0;
  return parseOutput(
    ConvertUnitsOutputSchema,
    { unitsCompatible, scaleFactor, offset },
    "convertUnits",
  );
}
