/**
 * Live integration tests for the `convertUnits` wrapper (issue #28).
 *
 * `convertUnits(s1, s2)` returns `(unitsCompatible, scaleFactor, offset)`
 * describing the affine transform between two unit strings. OMEdit calls it
 * as `convertUnits(unit, displayUnit)` and recovers the displayed value via
 * `(sourceValue - offset) / scaleFactor` (TextAnnotation.cpp:706,
 * Utilities::convertUnit). The values below were probed against OMC 1.26.7 —
 * identical with or without MSL loaded.
 *
 * Auto-skips when `omc` isn't on PATH.
 */

import { afterAll, beforeAll, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { describeIf } from "./fixtures.js";

/** Recover the displayed value the way OMEdit's Utilities::convertUnit does. */
function applyConversion(
  sourceValue: number,
  offset: number,
  scaleFactor: number,
): number {
  return (sourceValue - offset) / scaleFactor;
}

describeIf("convertUnits (live OMC)", () => {
  let client: OmcClient;

  beforeAll(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("rad → deg: compatible, scale ~0.01745, no offset", async () => {
    const { unitsCompatible, scaleFactor, offset } = await client.convertUnits({
      s1: "rad",
      s2: "deg",
    });
    expect(unitsCompatible).toBe(true);
    expect(scaleFactor).toBeCloseTo(0.017453292519943295, 12);
    expect(offset).toBe(0);
    // The acceptance case: 1.57 rad displayed in deg ≈ 90.
    expect(applyConversion(1.57, offset, scaleFactor)).toBeCloseTo(90, 1);
  });

  it("deg → rad: compatible, scale ~57.2958, no offset", async () => {
    const { unitsCompatible, scaleFactor, offset } = await client.convertUnits({
      s1: "deg",
      s2: "rad",
    });
    expect(unitsCompatible).toBe(true);
    expect(scaleFactor).toBeCloseTo(57.29577951308232, 8);
    expect(offset).toBe(0);
  });

  it("degC → K: compatible, unit scale, offset -273.15", async () => {
    const { unitsCompatible, scaleFactor, offset } = await client.convertUnits({
      s1: "degC",
      s2: "K",
    });
    expect(unitsCompatible).toBe(true);
    expect(scaleFactor).toBe(1);
    expect(offset).toBeCloseTo(-273.15, 6);
    // 0 K displayed in degC: (0 - (-273.15)) / 1 = 273.15.
    expect(applyConversion(0, offset, scaleFactor)).toBeCloseTo(273.15, 6);
  });

  it("incompatible units report unitsCompatible=false with neutral scale/offset", async () => {
    const { unitsCompatible, scaleFactor, offset } = await client.convertUnits({
      s1: "m",
      s2: "kg",
    });
    expect(unitsCompatible).toBe(false);
    expect(scaleFactor).toBe(1);
    expect(offset).toBe(0);
  });

  it("an empty unit string is treated as incompatible", async () => {
    const { unitsCompatible } = await client.convertUnits({
      s1: "",
      s2: "rad",
    });
    expect(unitsCompatible).toBe(false);
  });
});
