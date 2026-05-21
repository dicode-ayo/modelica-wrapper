/**
 * Unit tests for the pure unit-display helpers. No DOM — the WA-laden
 * component can't mount under happy-dom, so the suffix/dropdown decision
 * and the conversion math are tested at the data layer here.
 */

import { describe, expect, it } from "vitest";

import type { ParameterField, UnitOption } from "./parameter-fields.js";
import {
  backConvertToBaseUnit,
  convertShownValue,
  defaultSelectedUnit,
  unitWidgetForField,
} from "./unit-display.js";

/** Minimal ParameterField factory — only the unit-relevant fields matter. */
function field(over: Partial<ParameterField>): ParameterField {
  return {
    name: "p",
    kind: "number",
    required: false,
    value: undefined,
    defaultValue: undefined,
    description: undefined,
    enumValues: [],
    itemKind: undefined,
    tab: undefined,
    group: undefined,
    enable: undefined,
    enumTypeName: undefined,
    unit: undefined,
    displayUnit: undefined,
    unitOptions: [],
    ...over,
  };
}

const RAD_DEG: UnitOption[] = [
  { unit: "rad", scaleFactor: 1, offset: 0 },
  { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
];

// Factors as `convertUnits(baseUnit, option)`: degC = (K - 273.15) / 1,
// i.e. convertUnits("K", "degC") = (true, 1, 273.15).
const K_DEGC: UnitOption[] = [
  { unit: "K", scaleFactor: 1, offset: 0 },
  { unit: "degC", scaleFactor: 1, offset: 273.15 },
];

describe("unitWidgetForField", () => {
  it("renders nothing for a unit-less field", () => {
    expect(unitWidgetForField(field({}))).toEqual({ kind: "none" });
  });

  it("renders a static suffix for a single-option field (J → kg.m2)", () => {
    const w = unitWidgetForField(
      field({
        unit: "kg.m2",
        unitOptions: [{ unit: "kg.m2", scaleFactor: 1, offset: 0 }],
      }),
    );
    expect(w).toEqual({ kind: "suffix", unit: "kg.m2" });
  });

  it("falls back to the bare unit as a suffix when no options were enriched", () => {
    const w = unitWidgetForField(field({ unit: "kg.m2", unitOptions: [] }));
    expect(w).toEqual({ kind: "suffix", unit: "kg.m2" });
  });

  it("renders a dropdown for a multi-option field, default-selecting displayUnit", () => {
    const w = unitWidgetForField(
      field({ unit: "rad", displayUnit: "deg", unitOptions: RAD_DEG }),
    );
    expect(w.kind).toBe("dropdown");
    if (w.kind === "dropdown") {
      expect(w.selected).toBe("deg");
      expect(w.options).toEqual(RAD_DEG);
    }
  });

  it("default-selects the base unit when there is no displayUnit", () => {
    const w = unitWidgetForField(field({ unit: "rad", unitOptions: RAD_DEG }));
    expect(w.kind).toBe("dropdown");
    if (w.kind === "dropdown") expect(w.selected).toBe("rad");
  });
});

describe("defaultSelectedUnit", () => {
  it("picks displayUnit only when it differs and is an option", () => {
    expect(
      defaultSelectedUnit(
        field({ unit: "rad", displayUnit: "deg" }),
        RAD_DEG,
      ),
    ).toBe("deg");
  });

  it("falls back to base unit when displayUnit equals unit", () => {
    expect(
      defaultSelectedUnit(field({ unit: "rad", displayUnit: "rad" }), RAD_DEG),
    ).toBe("rad");
  });

  it("falls back to base unit when displayUnit isn't among the options", () => {
    expect(
      defaultSelectedUnit(field({ unit: "rad", displayUnit: "grad" }), RAD_DEG),
    ).toBe("rad");
  });
});

describe("convertShownValue", () => {
  it("converts rad → deg (1.5707963 rad ≈ 90 deg)", () => {
    const out = convertShownValue(Math.PI / 2, "rad", "deg", RAD_DEG);
    expect(out).toBeCloseTo(90, 9);
  });

  it("converts deg → rad (180 deg ≈ π rad)", () => {
    const out = convertShownValue(180, "deg", "rad", RAD_DEG);
    expect(out).toBeCloseTo(Math.PI, 9);
  });

  it("handles an affine offset (K ↔ degC)", () => {
    // 300 K shown in degC = 300 - 273.15 = 26.85
    expect(convertShownValue(300, "K", "degC", K_DEGC)).toBeCloseTo(26.85, 9);
    // round-trip back
    expect(convertShownValue(26.85, "degC", "K", K_DEGC)).toBeCloseTo(300, 9);
  });

  it("is a no-op when from === to", () => {
    expect(convertShownValue(42, "rad", "rad", RAD_DEG)).toBe(42);
  });

  it("returns undefined when a unit isn't in the option list", () => {
    expect(convertShownValue(1, "rad", "grad", RAD_DEG)).toBeUndefined();
    expect(convertShownValue(1, "grad", "deg", RAD_DEG)).toBeUndefined();
  });

  it("returns undefined for a non-finite value", () => {
    expect(convertShownValue(NaN, "rad", "deg", RAD_DEG)).toBeUndefined();
  });

  it("returns undefined when the target scale factor is zero", () => {
    const opts: UnitOption[] = [
      { unit: "a", scaleFactor: 1, offset: 0 },
      { unit: "b", scaleFactor: 0, offset: 0 },
    ];
    expect(convertShownValue(1, "a", "b", opts)).toBeUndefined();
  });
});

/**
 * Submit-side back-conversion — the round-trip that the value-corruption
 * blocker (PR #74) was missing. `backConvertToBaseUnit` is exactly what the
 * form's `onSubmit` runs per dropdown field: it returns the BASE-unit value
 * to emit, snapping to the original base initial on an unedited round-trip
 * so the host's strict-equality diff writes NOTHING.
 *
 * Scenarios mirror opening a `rad` param with `displayUnit="deg"` (shown as
 * 90 deg) and then:
 *   (a) submit UNCHANGED         → emit the base rad value, no host write
 *   (b) flip the dropdown only   → still emit the base rad value, no write
 *   (c) edit the displayed deg   → emit the corresponding base rad value
 */
describe("backConvertToBaseUnit (submit round-trip)", () => {
  // Original base initial from OMC for a 90°-on-open angle.
  const BASE_RAD = Math.PI / 2;
  // What the form shows after seeding into deg: (BASE_RAD - 0) / 0.0174… = 90.
  const SHOWN_DEG = convertShownValue(BASE_RAD, "rad", "deg", RAD_DEG)!;

  it("(a) UNCHANGED deg value back-converts to the EXACT base initial", () => {
    // The user opened the form (90 deg shown) and clicked Apply without
    // editing. The emitted value must be bit-for-bit the original rad
    // initial so the host diffs it as no change.
    const out = backConvertToBaseUnit(
      SHOWN_DEG,
      "deg",
      "rad",
      BASE_RAD,
      RAD_DEG,
    );
    expect(out).toBe(BASE_RAD); // strict equality — no spurious write
  });

  it("(a') guards float noise: a near-but-not-exact round-trip still snaps", () => {
    // Even if the deg→rad leg lands a few ULPs off, the tolerance snap must
    // return the original initial verbatim (Object.is-level equality).
    const noisy = SHOWN_DEG * (1 + 1e-14);
    const out = backConvertToBaseUnit(noisy, "deg", "rad", BASE_RAD, RAD_DEG);
    expect(out).toBe(BASE_RAD);
  });

  it("(b) dropdown flipped to base unit (rad) — value emitted unchanged", () => {
    // After flipping the dropdown back to rad, the selected unit IS the base
    // unit; the form passes `fromUnit === baseUnit`, so the shown value (now
    // in rad) is emitted as-is and equals the base initial.
    const out = backConvertToBaseUnit(
      BASE_RAD,
      "rad",
      "rad",
      BASE_RAD,
      RAD_DEG,
    );
    expect(out).toBe(BASE_RAD);
  });

  it("(b') dropdown flipped deg→grad without editing — still the base initial", () => {
    // A unit-only change to a *third* unit must also round-trip back to the
    // exact base initial (no value edit ⇒ no host write).
    const RAD_DEG_GRAD: UnitOption[] = [
      ...RAD_DEG,
      // 1 grad = π/200 rad ⇒ convertUnits("rad","grad") scale = π/200.
      { unit: "grad", scaleFactor: Math.PI / 200, offset: 0 },
    ];
    const shownGrad = convertShownValue(BASE_RAD, "rad", "grad", RAD_DEG_GRAD)!;
    const out = backConvertToBaseUnit(
      shownGrad,
      "grad",
      "rad",
      BASE_RAD,
      RAD_DEG_GRAD,
    );
    expect(out).toBe(BASE_RAD);
  });

  it("(c) EDITED deg value (180) back-converts to the correct base rad (π)", () => {
    const out = backConvertToBaseUnit(180, "deg", "rad", BASE_RAD, RAD_DEG);
    // A real edit — NOT snapped to the initial; equals π within float noise.
    expect(out).not.toBe(BASE_RAD);
    expect(out).toBeCloseTo(Math.PI, 9);
  });

  it("handles an affine offset on edit (degC → K)", () => {
    // Opened at 300 K shown as 26.85 degC; user edits to 100 degC.
    const out = backConvertToBaseUnit(100, "degC", "K", 300, K_DEGC);
    expect(out).toBeCloseTo(373.15, 9);
  });

  it("snaps an unedited offset round-trip (degC → K) to the base initial", () => {
    const shownDegC = convertShownValue(300, "K", "degC", K_DEGC)!;
    const out = backConvertToBaseUnit(shownDegC, "degC", "K", 300, K_DEGC);
    expect(out).toBe(300);
  });

  it("returns the shown value unchanged when conversion can't be performed", () => {
    // Unknown selected unit ⇒ convertShownValue is undefined ⇒ pass through.
    expect(backConvertToBaseUnit(5, "grad", "rad", BASE_RAD, RAD_DEG)).toBe(5);
  });

  it("emits the converted value when there is no numeric base initial to snap to", () => {
    // No prior initial (e.g. a newly-set field): just back-convert, never snap.
    const out = backConvertToBaseUnit(180, "deg", "rad", undefined, RAD_DEG);
    expect(out).toBeCloseTo(Math.PI, 9);
  });
});
