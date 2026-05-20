/**
 * Unit tests for the host-side displayUnit conversion (issue #28).
 *
 * Pure logic only — no OMC contact. `applyDisplayUnits` takes a resolver
 * stub so the conversion factors are supplied directly; the live half is
 * exercised by `display-unit.integration.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

import type { DiagramLayout } from "@modelica-wrapper/omc-client";
import type { ConvertUnitsOutput } from "@modelica-wrapper/omc-client/api/contents/index.js";

import {
  applyDisplayUnits,
  formatDisplayValue,
  type ConvertUnitsResolver,
} from "./display-unit.js";

const RAD_TO_DEG: ConvertUnitsOutput = {
  unitsCompatible: true,
  scaleFactor: 0.017453292519943295,
  offset: 0,
};
const DEGC_TO_K: ConvertUnitsOutput = {
  unitsCompatible: true,
  scaleFactor: 1.0,
  offset: -273.15,
};
const INCOMPATIBLE: ConvertUnitsOutput = {
  unitsCompatible: false,
  scaleFactor: 1.0,
  offset: 0,
};

describe("formatDisplayValue", () => {
  it("converts 1.57 rad → ~90 deg via (value - offset) / scaleFactor", () => {
    const out = formatDisplayValue("1.5707963267948966", RAD_TO_DEG, "deg");
    expect(out).toBe("90 deg");
  });

  it("applies a non-zero offset (degC → K via -273.15)", () => {
    // (0 - (-273.15)) / 1 = 273.15
    expect(formatDisplayValue("0", DEGC_TO_K, "K")).toBe("273.15 K");
  });

  it("omits the unit suffix when displayUnit is empty/undefined", () => {
    expect(formatDisplayValue("1.5707963267948966", RAD_TO_DEG)).toBe("90");
    expect(formatDisplayValue("1.5707963267948966", RAD_TO_DEG, "")).toBe("90");
  });

  it("returns undefined for incompatible units (caller keeps source value)", () => {
    expect(formatDisplayValue("1.57", INCOMPATIBLE, "kg")).toBeUndefined();
  });

  it("returns undefined for a zero scaleFactor (division guard)", () => {
    expect(
      formatDisplayValue("1.57", { unitsCompatible: true, scaleFactor: 0, offset: 0 }, "deg"),
    ).toBeUndefined();
  });

  it("returns undefined for a non-numeric source value (expression / enum)", () => {
    expect(formatDisplayValue("2 * pi", RAD_TO_DEG, "deg")).toBeUndefined();
    expect(formatDisplayValue("someEnum", RAD_TO_DEG, "deg")).toBeUndefined();
    expect(formatDisplayValue("", RAD_TO_DEG, "deg")).toBeUndefined();
  });

  it("does not truncate a value that merely starts with digits", () => {
    // `Number("1e3 Hz")` is NaN — we require the WHOLE string to parse.
    expect(formatDisplayValue("1e3 Hz", RAD_TO_DEG, "deg")).toBeUndefined();
  });
});

function makeLayout(
  parameters: DiagramLayout["classes"][string]["parameters"],
): DiagramLayout {
  return {
    kind: "diagram",
    className: "Test.Host",
    source: { filename: "<x>", lineStart: 1, columnStart: 1, lineEnd: 1, columnEnd: 1 },
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {
      "Test.Host": {
        name: "Test.Host",
        restriction: "model",
        iconLayers: [],
        connectors: {},
        parameters,
      },
    },
    components: {},
    connectors: {},
    connections: [],
  };
}

describe("applyDisplayUnits", () => {
  it("rewrites ParameterDef.value to the displayUnit value", async () => {
    const layout = makeLayout({
      a: { name: "a", value: "1.5707963267948966", unit: "rad", displayUnit: "deg" },
    });
    const resolve: ConvertUnitsResolver = async () => RAD_TO_DEG;
    await applyDisplayUnits(layout, resolve);
    expect(layout.classes["Test.Host"]!.parameters.a!.value).toBe("90 deg");
  });

  it("leaves params untouched when displayUnit is absent or equals unit", async () => {
    const layout = makeLayout({
      a: { name: "a", value: "1.57", unit: "rad" },
      b: { name: "b", value: "5", unit: "m", displayUnit: "m" },
    });
    const resolve = vi.fn<ConvertUnitsResolver>(async () => RAD_TO_DEG);
    await applyDisplayUnits(layout, resolve);
    expect(layout.classes["Test.Host"]!.parameters.a!.value).toBe("1.57");
    expect(layout.classes["Test.Host"]!.parameters.b!.value).toBe("5");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("leaves a non-numeric value untouched without calling the resolver", async () => {
    const layout = makeLayout({
      a: { name: "a", value: "2 * pi", unit: "rad", displayUnit: "deg" },
    });
    const resolve = vi.fn<ConvertUnitsResolver>(async () => RAD_TO_DEG);
    await applyDisplayUnits(layout, resolve);
    expect(layout.classes["Test.Host"]!.parameters.a!.value).toBe("2 * pi");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps the source value (and warns) when units are incompatible", async () => {
    const layout = makeLayout({
      a: { name: "a", value: "1.57", unit: "rad", displayUnit: "kg" },
    });
    const warn = vi.fn();
    await applyDisplayUnits(layout, async () => INCOMPATIBLE, warn);
    expect(layout.classes["Test.Host"]!.parameters.a!.value).toBe("1.57");
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the source value when the resolver throws (best-effort)", async () => {
    const layout = makeLayout({
      a: { name: "a", value: "1.57", unit: "rad", displayUnit: "deg" },
    });
    const warn = vi.fn();
    await applyDisplayUnits(
      layout,
      async () => {
        throw new Error("omc down");
      },
      warn,
    );
    expect(layout.classes["Test.Host"]!.parameters.a!.value).toBe("1.57");
    expect(warn).toHaveBeenCalled();
  });

  it("caches the convertUnits result per (unit, displayUnit) pair", async () => {
    const layout = makeLayout({
      a: { name: "a", value: "1.5707963267948966", unit: "rad", displayUnit: "deg" },
      b: { name: "b", value: "3.141592653589793", unit: "rad", displayUnit: "deg" },
    });
    const resolve = vi.fn<ConvertUnitsResolver>(async () => RAD_TO_DEG);
    await applyDisplayUnits(layout, resolve);
    expect(layout.classes["Test.Host"]!.parameters.a!.value).toBe("90 deg");
    expect(layout.classes["Test.Host"]!.parameters.b!.value).toBe("180 deg");
    // Two params, same pair → exactly one resolver call.
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
