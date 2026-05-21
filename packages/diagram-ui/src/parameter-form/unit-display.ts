/**
 * Pure unit-display helpers for `<om-parameter-form>` (issue #72).
 *
 * The form shows units the way OMEdit does
 * (`OMEdit/OMEditLIB/Element/ElementProperties.cpp:242-266, 1687-1700`):
 *
 *   - empty unit / no options → render nothing
 *   - exactly one option      → a static unit-suffix label
 *   - two or more options     → a unit dropdown, default-selecting
 *     `displayUnit` when it differs from the base `unit`
 *
 * On dropdown change the shown value is converted with the host-pre-shipped
 * affine factors so the conversion is SYNCHRONOUS (no OMC round-trip):
 *
 *   shown = (sourceValue - offset) / scaleFactor
 *
 * Kept free of Lit / DOM imports so the decision + conversion logic is
 * unit-testable without mounting the WA-laden component (happy-dom can't
 * mount `wa-button`).
 */

import type { ParameterField, UnitOption } from "./parameter-fields.js";

/** How the unit widget for a field should render. */
export type UnitWidget =
  | { kind: "none" }
  | { kind: "suffix"; unit: string }
  | {
      kind: "dropdown";
      options: ReadonlyArray<UnitOption>;
      /** Unit to default-select (the field's `displayUnit` when it differs). */
      selected: string;
    };

/**
 * Decide the unit widget for a field from its `unit` / `displayUnit` /
 * `unitOptions` metadata.
 *
 * Option-list precedence:
 *   1. The host-enriched `unitOptions` (carries conversion factors). When
 *      it has ≥2 entries → dropdown; exactly 1 → suffix.
 *   2. Fallback when no enriched list arrived but the field still has a
 *      bare `unit` — render it as a static suffix so units stay VISIBLE
 *      even if the host couldn't pre-fetch derived units (the core ask).
 *
 * The default-selected unit is `displayUnit` when present, differs from
 * `unit`, and is actually one of the options; otherwise the base `unit`.
 */
export function unitWidgetForField(field: ParameterField): UnitWidget {
  const options = field.unitOptions ?? [];
  if (options.length >= 2) {
    return {
      kind: "dropdown",
      options,
      selected: defaultSelectedUnit(field, options),
    };
  }
  if (options.length === 1) {
    return { kind: "suffix", unit: options[0]!.unit };
  }
  // No enriched options — fall back to the bare declaration unit so the
  // suffix still shows. Trim guards against a whitespace-only unit.
  const bare = field.unit?.trim();
  if (bare && bare.length > 0) return { kind: "suffix", unit: bare };
  return { kind: "none" };
}

/**
 * The unit to pre-select in the dropdown: the field's `displayUnit` when it
 * is present, differs from the base `unit`, and is in the option list;
 * otherwise the base `unit` (or the first option as a last resort).
 */
export function defaultSelectedUnit(
  field: ParameterField,
  options: ReadonlyArray<UnitOption>,
): string {
  const unit = field.unit?.trim();
  const displayUnit = field.displayUnit?.trim();
  if (
    displayUnit &&
    displayUnit.length > 0 &&
    displayUnit !== unit &&
    options.some((o) => o.unit === displayUnit)
  ) {
    return displayUnit;
  }
  if (unit && options.some((o) => o.unit === unit)) return unit;
  return options[0]?.unit ?? unit ?? "";
}

/**
 * Convert a shown value from `fromUnit` to `toUnit` using the field's
 * pre-shipped affine factors, recovering the source (base-unit) value first
 * and then re-expressing it in the target unit. Both legs use:
 *
 *   source = shown * scaleFactor(unit) + offset(unit)
 *   shown  = (source - offset(unit)) / scaleFactor(unit)
 *
 * (The factors are `convertUnits(baseUnit, optionUnit)` per OMEdit, so the
 * forward direction multiplies and the inverse — what we render — divides.)
 *
 * Returns `undefined` (caller should leave the value as-is) when the value
 * isn't a finite number, either unit is missing from the option list, or a
 * factor would divide by zero — mirroring OMEdit disabling conversion for
 * non-literal values.
 */
export function convertShownValue(
  shown: number,
  fromUnit: string,
  toUnit: string,
  options: ReadonlyArray<UnitOption>,
): number | undefined {
  if (!Number.isFinite(shown)) return undefined;
  if (fromUnit === toUnit) return shown;
  const from = options.find((o) => o.unit === fromUnit);
  const to = options.find((o) => o.unit === toUnit);
  if (!from || !to) return undefined;
  if (!Number.isFinite(to.scaleFactor) || to.scaleFactor === 0) return undefined;
  if (!Number.isFinite(from.scaleFactor)) return undefined;
  // Recover the base-unit value from the currently-shown one, then
  // re-express it in the target unit.
  const source = shown * from.scaleFactor + from.offset;
  const next = (source - to.offset) / to.scaleFactor;
  return Number.isFinite(next) ? next : undefined;
}

/**
 * Relative tolerance for treating a back-converted base value as
 * "unchanged" from the original base initial. A display-unit round-trip
 * (e.g. base `rad` → shown `deg` on open → base `rad` on submit) goes
 * through two affine divisions, so it is rarely bit-exact; without a
 * tolerance an UNEDITED field would back-convert to e.g. `1.5707963…2`
 * instead of the original `1.5707963…0` and the host would diff it as a
 * change, writing a spurious modifier. `1e-9` is far below any meaningful
 * parameter precision yet comfortably above IEEE-754 round-trip noise.
 */
export const UNIT_ROUNDTRIP_REL_TOLERANCE = 1e-9;

/**
 * Convert a field's currently-shown value (in `fromUnit`) back to its base
 * declaration `unit` for submit, snapping to the original base initial when
 * the round-trip lands within tolerance.
 *
 * The host diffs each submitted value against the original base-unit
 * initial with STRICT equality, so an unedited display-unit field must emit
 * the original number EXACTLY — otherwise float round-trip noise reads as a
 * change and writes a spurious modifier. We therefore:
 *
 *   1. back-convert `shown` from `fromUnit` to `baseUnit`, then
 *   2. if that result is within {@link UNIT_ROUNDTRIP_REL_TOLERANCE} of
 *      `baseInitial`, return `baseInitial` UNCHANGED (the exact original),
 *      so the host sees no diff;
 *   3. otherwise return the converted base value (a real edit).
 *
 * Returns `shown` unchanged when `fromUnit === baseUnit` (no dropdown
 * divergence) or when the conversion can't be performed (non-numeric /
 * missing option / zero scale) — leaving the value as-is, matching the
 * convert-disabled behaviour elsewhere.
 */
export function backConvertToBaseUnit(
  shown: number,
  fromUnit: string,
  baseUnit: string,
  baseInitial: unknown,
  options: ReadonlyArray<UnitOption>,
): number {
  if (fromUnit === baseUnit) return shown;
  const converted = convertShownValue(shown, fromUnit, baseUnit, options);
  if (converted === undefined) return shown;
  if (
    typeof baseInitial === "number" &&
    Number.isFinite(baseInitial) &&
    approxEqualRelative(converted, baseInitial, UNIT_ROUNDTRIP_REL_TOLERANCE)
  ) {
    // Unedited (value-wise) — emit the original base number bit-for-bit so
    // the host's strict-equality diff writes nothing.
    return baseInitial;
  }
  return converted;
}

/**
 * Relative-tolerance float comparison. Uses an absolute fallback scaled by
 * the larger magnitude so values near zero (where a pure ratio is unstable)
 * still compare sanely; `a === b` short-circuits the exact case.
 */
function approxEqualRelative(a: number, b: number, relTol: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= relTol * scale;
}
