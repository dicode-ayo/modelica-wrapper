/**
 * Unit tests for the pure unit-display helpers. No DOM — the WA-laden
 * component can't mount under happy-dom, so the suffix/dropdown decision
 * and the conversion math are tested at the data layer here.
 */

import { describe, expect, it } from "vitest";

import type { ParameterField, UnitOption } from "./parameter-fields.js";
import {
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
    raw: {},
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
