import { describe, expect, it } from "vitest";
import type { JsonSchema } from "@modelica-wrapper/omc-client";
import type { ConvertUnitsOutput } from "@modelica-wrapper/omc-client/api/contents/index.js";

import { enrichUnitOptions } from "./unit-options.js";

/** Stub `convertUnits` with the live OMC factors used in the wrapper doc. */
function convertStub(s1: string, s2: string): Promise<ConvertUnitsOutput> {
  // Factors are `convertUnits(s1=baseUnit, s2=option)` per the wrapper doc:
  // `displayValue = (sourceValue - offset) / scaleFactor`.
  const table: Record<string, ConvertUnitsOutput> = {
    "rad deg": { unitsCompatible: true, scaleFactor: 0.017453292519943295, offset: 0 },
    "K degC": { unitsCompatible: true, scaleFactor: 1, offset: 273.15 },
    "K degF": { unitsCompatible: true, scaleFactor: 0.5555555555555556, offset: 255.3722222222222 },
    "m kg": { unitsCompatible: false, scaleFactor: 1, offset: 0 },
  };
  return Promise.resolve(
    table[`${s1} ${s2}`] ?? { unitsCompatible: false, scaleFactor: 1, offset: 0 },
  );
}

describe("enrichUnitOptions", () => {
  it("adds a single identity option for a single-unit field (J → kg.m2)", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        J: { type: "number", "x-modelica-unit": "kg.m2" } as JsonSchema,
      },
    };
    await enrichUnitOptions(
      schema,
      () => Promise.resolve([]), // no derived units for kg.m2
      convertStub,
    );
    const J = schema.properties!.J as Record<string, unknown>;
    expect(J["x-modelica-unit-options"]).toEqual([
      { unit: "kg.m2", scaleFactor: 1, offset: 0 },
    ]);
  });

  it("builds [unit, displayUnit, ...derived] with conversion factors (rad/deg)", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        phi: {
          type: "number",
          "x-modelica-unit": "rad",
          "x-modelica-display-unit": "deg",
        } as JsonSchema,
      },
    };
    await enrichUnitOptions(
      schema,
      (u) => Promise.resolve(u === "rad" ? ["deg"] : []),
      convertStub,
    );
    const phi = schema.properties!.phi as Record<string, unknown>;
    // identity option first, then deg with its scale factor; deduped
    // (displayUnit deg and derived deg collapse to one entry).
    expect(phi["x-modelica-unit-options"]).toEqual([
      { unit: "rad", scaleFactor: 1, offset: 0 },
      { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
    ]);
  });

  it("includes affine-offset units (K → degC, degF) from getDerivedUnits", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        T: { type: "number", "x-modelica-unit": "K" } as JsonSchema,
      },
    };
    await enrichUnitOptions(
      schema,
      (u) => Promise.resolve(u === "K" ? ["degC", "degF", "degRk"] : []),
      convertStub,
    );
    const T = schema.properties!.T as Record<string, unknown>;
    // degRk has no stub entry → incompatible → dropped.
    expect(T["x-modelica-unit-options"]).toEqual([
      { unit: "K", scaleFactor: 1, offset: 0 },
      { unit: "degC", scaleFactor: 1, offset: 273.15 },
      { unit: "degF", scaleFactor: 0.5555555555555556, offset: 255.3722222222222 },
    ]);
  });

  it("drops incompatible options but keeps the base unit (suffix still renders)", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        x: { type: "number", "x-modelica-unit": "m" } as JsonSchema,
      },
    };
    await enrichUnitOptions(
      schema,
      () => Promise.resolve(["kg"]), // bogus derived unit, incompatible
      convertStub,
    );
    const x = schema.properties!.x as Record<string, unknown>;
    expect(x["x-modelica-unit-options"]).toEqual([
      { unit: "m", scaleFactor: 1, offset: 0 },
    ]);
  });

  it("survives a getDerivedUnits throw and falls back to the base unit", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        x: { type: "number", "x-modelica-unit": "rad" } as JsonSchema,
      },
    };
    await enrichUnitOptions(
      schema,
      () => Promise.reject(new Error("OMC down")),
      convertStub,
    );
    const x = schema.properties!.x as Record<string, unknown>;
    expect(x["x-modelica-unit-options"]).toEqual([
      { unit: "rad", scaleFactor: 1, offset: 0 },
    ]);
  });

  it("leaves unit-less fields untouched", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        k: { type: "number" },
      },
    };
    await enrichUnitOptions(schema, () => Promise.resolve([]), convertStub);
    const k = schema.properties!.k as Record<string, unknown>;
    expect("x-modelica-unit-options" in k).toBe(false);
  });
});
