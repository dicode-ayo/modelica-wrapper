/**
 * Host-side unit annotation for diagram parameter labels
 * (issue #28 / #68 — convert; issue #71 — generalize to plain units).
 *
 * The webview text-render path (`diagram-ui` `<om-text>` +
 * `build-substitutions.ts`) is SYNCHRONOUS and has no `OmcClient`: it just
 * interpolates a flat `Record<string, string>` substitution map built from
 * `ClassDef.parameters[name].value`. So a `parameter Angle a(displayUnit=
 * "deg") = 1.5707963267948966` would render `1.57…` verbatim in a `%a`
 * label even though the user asked to see `deg`, and a `parameter Inertia
 * J = 1` would render a bare `1` with no `kg.m2` suffix.
 *
 * OMEdit annotates each `%param` token at render time
 * (`Annotations/TextAnnotation.cpp:614-636`): for a literal-constant value
 * it appends `displayUnit` if set, otherwise the declared `unit`. When the
 * two differ it first converts via `OMCProxy::convertUnits(unit,
 * displayUnit)`; when they're equal (or there's no displayUnit) it appends
 * the raw unit symbol with no conversion. We can't call OMC from the
 * webview, so we do the same HOST-SIDE during the layout build
 * (`open-diagram.ts` `fetchLayout`), where the `OmcClient` lives, and
 * rewrite `ParameterDef.value` to the annotated display string.
 *
 * Two branches, mirroring OMEdit:
 *   - displayUnit set AND differs from unit → call `convertUnits`, recover
 *     `displayValue = (sourceValue - offset) / scaleFactor`, append
 *     `displayUnit`. e.g. `rad` → `deg`: `(1.5707963267948966 - 0) /
 *     0.0174… = 90`, rendered `"90 deg"`.
 *   - no displayUnit OR displayUnit == unit → append the bare `unit`, no
 *     OMC contact. e.g. `J=1`, `unit="kg.m2"` → `"1 kg.m2"`.
 *
 * Both branches only touch literal-numeric values (`parseNumeric`);
 * expressions / enums / crefs / blanks pass through untouched, matching
 * OMEdit's `isValueLiteralConstant` guard. The degenerate `unit=="1"` case
 * (dimensionless, OMC's placeholder for "no unit") is skipped — OMEdit
 * skips the `"1"`x`"1"` pair; we skip any `unit=="1"` since there's nothing
 * meaningful to show.
 *
 * Value-vs-displayValue: we mutate `ParameterDef.value` in place rather
 * than adding a parallel `ParameterDef.displayValue`. `buildSubstitutions`
 * already reads `def.value` for class defaults, so rewriting it makes
 * `%paramName` show the annotated number with ZERO diagram-ui changes. The
 * only consumer of `ParameterDef.value` in the layout is
 * `build-substitutions.ts`; the parameter-editor forms read the raw OMC
 * `ModelInstance` (`el.value`), not the layout, so they are unaffected.
 *
 * Conversion direction confirmed against the `convertUnits` wrapper doc
 * `packages/omc-client/src/api/contents/convertUnits.ts` + OMEdit
 * `Utilities::convertUnit`.
 */

import type {
  DiagramLayout,
  ParameterDef,
} from "@modelica-wrapper/omc-client";
import type { ConvertUnitsOutput } from "@modelica-wrapper/omc-client/api/contents/index.js";

/**
 * Apply an already-fetched `convertUnits` result to a source-unit numeric
 * string and produce the display-unit string.
 *
 * Pure — no OMC contact. Returns `undefined` (caller leaves the value
 * untouched) when the conversion shouldn't happen:
 *   - units are incompatible (`unitsCompatible === false`),
 *   - `scaleFactor` is not a finite non-zero number (division would blow up),
 *   - the source value isn't a finite number (expressions, enums, blanks).
 *
 * The display unit, when given, is appended after a space — matching how
 * OMEdit annotates a converted parameter label with its unit suffix.
 */
export function formatDisplayValue(
  sourceValue: string,
  conversion: ConvertUnitsOutput,
  displayUnit?: string,
): string | undefined {
  if (!conversion.unitsCompatible) return undefined;
  const { scaleFactor, offset } = conversion;
  if (!Number.isFinite(scaleFactor) || scaleFactor === 0) return undefined;
  if (!Number.isFinite(offset)) return undefined;

  const parsed = parseNumeric(sourceValue);
  if (parsed === undefined) return undefined;

  const displayed = (parsed - offset) / scaleFactor;
  if (!Number.isFinite(displayed)) return undefined;

  const numberPart = formatNumber(displayed);
  const unit = displayUnit?.trim();
  return unit && unit.length > 0 ? `${numberPart} ${unit}` : numberPart;
}

/**
 * Parse a display string as a finite number. `def.value` is a flat display
 * string; only a value that parses cleanly as a finite number is convertible
 * — non-numeric bindings (expressions, enums, crefs, blanks) return
 * `undefined` and pass through untouched.
 *
 * We require the WHOLE trimmed string to be the number (via `Number(...)`)
 * rather than `parseFloat`, so `"1.5 + x"` or `"1e3 Hz"` don't get
 * silently truncated to a leading numeric prefix.
 */
function parseNumeric(s: string): number | undefined {
  const t = s.trim();
  if (t.length === 0) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Number of significant digits OMEdit's `QString::number(v, 'g', N)` uses
 * when formatting a converted parameter value. Six matches OMEdit's
 * `Utilities::convertUnit` display precision and is enough to round
 * float-conversion artefacts (`89.99999999999999`) back to the intended
 * value (`90`) without losing real precision on typical angles / gains.
 */
const DISPLAY_SIG_DIGITS = 6;

/**
 * Render a converted number back to a compact display string.
 *
 * `String(n)` round-trips the IEEE-754 value exactly, which surfaces
 * float-conversion noise: `(pi/2) / (pi/180)` lands on `89.99999999999999`,
 * not `90`. OMEdit avoids this by formatting with `QString::number(v, 'g',
 * 6)`. We mirror that: round to 6 significant digits via `toPrecision`, then
 * strip the trailing zeros / redundant exponent that `toPrecision` can leave
 * (`90.0000` → `90`, `1.50000` → `1.5`) so the label stays compact and
 * matches the literal style of the source-unit values we replace.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  // `toPrecision` gives 6 significant figures; `Number(...)` then collapses
  // trailing zeros and any "1.5000" / "9.0000e1" form back to the shortest
  // decimal that represents the rounded value.
  const rounded = Number(n.toPrecision(DISPLAY_SIG_DIGITS));
  return String(rounded);
}

/**
 * Cache key for a `(unit, displayUnit)` pair — the conversion factor is
 * shared across every instance/parameter with the same pair, so we look it
 * up once per pair per layout build.
 */
export function unitPairKey(unit: string, displayUnit: string): string {
  return `${unit} ${displayUnit}`;
}

/**
 * A `(unit, displayUnit) -> convertUnits` resolver. The extension supplies
 * one backed by `OmcClient.convertUnits` (with caching); tests supply a
 * pure stub. Returning `undefined` means "couldn't resolve — leave the
 * value as-is".
 */
export type ConvertUnitsResolver = (
  unit: string,
  displayUnit: string,
) => Promise<ConvertUnitsOutput | undefined>;

/**
 * Logger seam — the extension passes its `log.warn`; tests can pass a noop.
 */
export type WarnFn = (topic: string, message: string, data?: unknown) => void;

/**
 * Walk every `ParameterDef` in the layout and annotate its `value` with the
 * parameter's unit, matching OMEdit `TextAnnotation.cpp:614-636`:
 *   - `displayUnit` set AND differs from `unit` → convert via the resolver
 *     and append `displayUnit`;
 *   - otherwise (no `displayUnit`, or `displayUnit == unit`) → append the
 *     bare `unit` with no OMC contact (so `value="1"`, `unit="kg.m2"` →
 *     `"1 kg.m2"`).
 *
 * Only literal-numeric values are annotated (`parseNumeric`); expressions,
 * enums, crefs and blanks pass through untouched. An empty unit, the
 * degenerate `unit=="1"` dimensionless placeholder, and a value that
 * already ends with its unit are all skipped.
 *
 * Best-effort: a resolver miss, an incompatible-unit verdict, or a
 * non-numeric source value all leave the original value untouched (logged
 * via `warn`, never thrown). Conversion results are cached by `(unit,
 * displayUnit)` for the duration of the pass.
 *
 * Mutates `layout` in place and returns it (the layout is freshly produced
 * per fetch, so in-place mutation has no aliasing hazard).
 *
 * KNOWN LIMITATION — `displayUnit` conversion reaches CLASS DEFAULTS only,
 * not INSTANCE MODIFIERS. This pass walks `layout.classes[*].parameters`
 * (the class-level `ParameterDef`s) and is the ONLY place a `displayUnit`
 * conversion happens, because it needs `convertUnits` (OMC). The webview
 * substitution path (`diagram-ui` `build-substitutions.ts` `appendUnits`)
 * is synchronous and has no `OmcClient`, so it cannot convert. The
 * consequence: a `displayUnit` parameter whose VALUE is supplied by an
 * instance modifier — `Angle phi(displayUnit="deg")` with `c(phi=1.57)` on
 * the instance — is overlaid on top of this rewritten class default in
 * `build-substitutions.ts` AFTER this pass has run, so the converted
 * `"90 deg"` is discarded and the raw `1.57` re-surfaces. The webview then
 * appends the honest SOURCE unit (`appendUnits`) and the label reads
 * `1.57 rad`, not OMEdit's `90 deg`. This is intentional: with no OMC on
 * the webview side, showing the true source unit beats mislabelling the raw
 * value with a unit it was never converted into. Lifting it would require
 * an OMC-backed conversion seam in the webview path (or pre-converting
 * instance-modifier values host-side before they reach the substitution
 * overlay). See `build-substitutions.ts` `appendUnits` for the webview half.
 */
export async function applyDisplayUnits(
  layout: DiagramLayout,
  resolve: ConvertUnitsResolver,
  warn: WarnFn = () => {},
): Promise<DiagramLayout> {
  const cache = new Map<string, ConvertUnitsOutput | undefined>();

  for (const cls of Object.values(layout.classes)) {
    for (const def of Object.values(cls.parameters)) {
      await annotateOne(def, resolve, cache, warn);
    }
  }
  return layout;
}

async function annotateOne(
  def: ParameterDef,
  resolve: ConvertUnitsResolver,
  cache: Map<string, ConvertUnitsOutput | undefined>,
  warn: WarnFn,
): Promise<void> {
  const unit = def.unit?.trim();
  // No unit, or OMC's dimensionless placeholder "1" → nothing to show.
  // (OMEdit skips the `unit=="1" && displayUnit=="1"` pair; with no
  // meaningful symbol to append we skip any `unit=="1"`.)
  if (!unit || unit === "1") return;
  // Only literal-numeric values get a unit — expressions / enums / crefs /
  // blanks pass through (OMEdit's `isValueLiteralConstant` guard). This is
  // also the cheap pre-filter that avoids an OMC round-trip in the convert
  // branch.
  if (parseNumeric(def.value) === undefined) return;

  const displayUnit = def.displayUnit?.trim();
  // No displayUnit, or it equals the declared unit → append the bare unit,
  // no conversion, no resolver call (OMEdit's `unit == displayUnit` arm).
  if (!displayUnit || displayUnit === unit) {
    def.value = appendUnit(def.value, unit);
    return;
  }

  // displayUnit differs → convert, then append displayUnit.
  const key = unitPairKey(unit, displayUnit);
  let conversion = cache.get(key);
  if (!cache.has(key)) {
    try {
      conversion = await resolve(unit, displayUnit);
    } catch (err) {
      warn(
        "applyDisplayUnits",
        `convertUnits(${unit}, ${displayUnit}) failed for ${def.name}`,
        err instanceof Error ? err.message : err,
      );
      conversion = undefined;
    }
    cache.set(key, conversion);
  }
  if (conversion === undefined) return;

  const display = formatDisplayValue(def.value, conversion, displayUnit);
  if (display === undefined) {
    if (!conversion.unitsCompatible) {
      warn(
        "applyDisplayUnits",
        `units incompatible — ${def.name}: ${unit} → ${displayUnit}; rendering source value`,
      );
    }
    return;
  }
  def.value = display;
}

/**
 * Append a bare unit symbol to a value, defensively skipping the case where
 * the value already ends with that unit. `applyDisplayUnits` runs once per
 * fetch on a fresh layout so a double-append shouldn't arise, but the guard
 * keeps the function safe to call repeatedly.
 */
function appendUnit(value: string, unit: string): string {
  const v = value.trim();
  if (v.endsWith(` ${unit}`)) return value;
  return `${v} ${unit}`;
}
