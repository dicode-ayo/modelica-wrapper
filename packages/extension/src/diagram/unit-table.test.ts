/**
 * Unit tests for the session-cached unit table (`unit-table.ts`).
 *
 * No live OMC — a stub `OmcClient` records calls so we can assert:
 *  - the option list shape (`[unit, ...derived]`, deduped, identity first,
 *    incompatible options dropped, base unit always kept);
 *  - per-(unit, displayUnit) conversion caching;
 *  - the design-doc acceptance point: a base unit's `getDerivedUnits` /
 *    `convertUnits` calls are issued AT MOST ONCE per session — re-opening a
 *    panel (re-building a table for the same units) hits the cache, not OMC;
 *  - the cache is shared between the form path and the label path
 *    (`convertUnits` reuses what `buildUnitTable` already resolved).
 */

import { describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@dicode/omc-client";
import type { ConvertUnitsOutput } from "@dicode/omc-client/api/contents/index.js";

import type { ParameterModel } from "@dicode/omc-client";

import {
  SessionUnitCache,
  sessionUnitCache,
  collectDisplayUnitsByBase,
} from "./unit-table.js";

/** Live OMC factors (from the wrapper docs) keyed `s1 s2`. */
const CONVERT: Record<string, ConvertUnitsOutput> = {
  "rad deg": { unitsCompatible: true, scaleFactor: 0.017453292519943295, offset: 0 },
  // gradians — a valid displayUnit for rad that OMC does NOT list among the
  // derived units, so it only reaches the dropdown via the extras path.
  "rad grad": { unitsCompatible: true, scaleFactor: 0.015707963267948967, offset: 0 },
  "K degC": { unitsCompatible: true, scaleFactor: 1, offset: 273.15 },
  "K degF": { unitsCompatible: true, scaleFactor: 0.5555555555555556, offset: 255.3722222222222 },
  "m kg": { unitsCompatible: false, scaleFactor: 1, offset: 0 },
};

const DERIVED: Record<string, string[]> = {
  rad: ["deg"],
  K: ["degC", "degF", "degRk"],
  m: ["kg"], // bogus / incompatible derived unit
  "kg.m2": [],
};

function makeClient(): {
  client: OmcClient;
  derivedCalls: string[];
  convertCalls: string[];
} {
  const derivedCalls: string[] = [];
  const convertCalls: string[] = [];
  const getDerivedUnits = vi.fn(async ({ baseUnit }: { baseUnit: string }) => {
    derivedCalls.push(baseUnit);
    return { derivedUnits: DERIVED[baseUnit] ?? [] };
  });
  const convertUnits = vi.fn(
    async ({ s1, s2 }: { s1: string; s2: string }) => {
      convertCalls.push(`${s1} ${s2}`);
      return (
        CONVERT[`${s1} ${s2}`] ?? {
          unitsCompatible: false,
          scaleFactor: 1,
          offset: 0,
        }
      );
    },
  );
  const client = { getDerivedUnits, convertUnits } as unknown as OmcClient;
  return { client, derivedCalls, convertCalls };
}

describe("SessionUnitCache.buildUnitTable", () => {
  it("builds a single identity option for a unit with no derived units (kg.m2)", async () => {
    const { client } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(["kg.m2"]);
    expect(table.get("kg.m2")).toEqual([{ unit: "kg.m2", scaleFactor: 1, offset: 0 }]);
  });

  it("builds [unit, ...derived] with conversion factors (rad → deg), identity first", async () => {
    const { client } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(["rad"]);
    expect(table.get("rad")).toEqual([
      { unit: "rad", scaleFactor: 1, offset: 0 },
      { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
    ]);
  });

  it("includes affine-offset units and drops incompatible derived ones (K)", async () => {
    const { client } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(["K"]);
    // degRk has no CONVERT entry → incompatible → dropped.
    expect(table.get("K")).toEqual([
      { unit: "K", scaleFactor: 1, offset: 0 },
      { unit: "degC", scaleFactor: 1, offset: 273.15 },
      { unit: "degF", scaleFactor: 0.5555555555555556, offset: 255.3722222222222 },
    ]);
  });

  it("drops an incompatible derived unit but keeps the base (suffix renders)", async () => {
    const { client } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(["m"]);
    expect(table.get("m")).toEqual([{ unit: "m", scaleFactor: 1, offset: 0 }]);
  });

  it("skips the empty + dimensionless '1' base units", async () => {
    const { client, derivedCalls } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(["", "1", "rad"]);
    expect([...table.keys()]).toEqual(["rad"]);
    // No getDerivedUnits for "" / "1".
    expect(derivedCalls).toEqual(["rad"]);
  });

  it("dedupes base units within a single build", async () => {
    const { client, derivedCalls } = makeClient();
    const cache = new SessionUnitCache(client);
    await cache.buildUnitTable(["rad", "rad", "kg.m2"]);
    expect(derivedCalls).toEqual(["rad", "kg.m2"]);
  });

  it("folds a declared displayUnit not in getDerivedUnits into the option list", async () => {
    const { client } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(
      ["rad"],
      new Map([["rad", ["grad"]]]),
    );
    // base + derived (deg) + the extra displayUnit (grad), appended last.
    expect(table.get("rad")).toEqual([
      { unit: "rad", scaleFactor: 1, offset: 0 },
      { unit: "deg", scaleFactor: 0.017453292519943295, offset: 0 },
      { unit: "grad", scaleFactor: 0.015707963267948967, offset: 0 },
    ]);
  });

  it("does not duplicate a displayUnit that is already a derived unit", async () => {
    const { client, convertCalls } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(
      ["rad"],
      new Map([["rad", ["deg"]]]),
    );
    expect(table.get("rad")?.map((o) => o.unit)).toEqual(["rad", "deg"]);
    // deg was already resolved as a derived unit → no second convertUnits call.
    expect(convertCalls).toEqual(["rad deg"]);
  });

  it("drops an incompatible extra displayUnit but keeps the rest", async () => {
    const { client } = makeClient();
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(
      ["rad"],
      new Map([["rad", ["bogus"]]]),
    );
    // bogus has no CONVERT entry → incompatible → dropped; deg stays.
    expect(table.get("rad")?.map((o) => o.unit)).toEqual(["rad", "deg"]);
  });

  it("survives a getDerivedUnits throw, falling back to the base unit", async () => {
    const getDerivedUnits = vi.fn(async () => {
      throw new Error("OMC down");
    });
    const convertUnits = vi.fn(async () => ({
      unitsCompatible: true,
      scaleFactor: 1,
      offset: 0,
    }));
    const client = { getDerivedUnits, convertUnits } as unknown as OmcClient;
    const cache = new SessionUnitCache(client);
    const table = await cache.buildUnitTable(["rad"]);
    expect(table.get("rad")).toEqual([{ unit: "rad", scaleFactor: 1, offset: 0 }]);
  });
});

describe("SessionUnitCache — session-level dedup (design-doc acceptance)", () => {
  it("issues a base unit's OMC calls AT MOST ONCE across panel re-opens", async () => {
    const { client, derivedCalls, convertCalls } = makeClient();
    const cache = new SessionUnitCache(client);

    // First "panel open" — resolves rad + its conversions.
    await cache.buildUnitTable(["rad"]);
    expect(derivedCalls).toEqual(["rad"]);
    expect(convertCalls).toEqual(["rad deg"]);

    // Second "panel open" for the same class/units — pure cache hit.
    await cache.buildUnitTable(["rad"]);
    expect(derivedCalls).toEqual(["rad"]); // unchanged
    expect(convertCalls).toEqual(["rad deg"]); // unchanged
  });

  it("shares the convertUnits cache between the form table and the label path", async () => {
    const { client, convertCalls } = makeClient();
    const cache = new SessionUnitCache(client);

    // Form path resolves rad→deg while building the option list.
    await cache.buildUnitTable(["rad"]);
    expect(convertCalls).toEqual(["rad deg"]);

    // Label path (applyDisplayUnits) asks for the same pair — no new call.
    const conv = await cache.convertUnits("rad", "deg");
    expect(conv?.scaleFactor).toBeCloseTo(0.017453292519943295, 12);
    expect(convertCalls).toEqual(["rad deg"]); // still just one
  });

  it("short-circuits an identity convertUnits pair without an OMC call", async () => {
    const { client, convertCalls } = makeClient();
    const cache = new SessionUnitCache(client);
    const conv = await cache.convertUnits("kg.m2", "kg.m2");
    expect(conv).toEqual({ unitsCompatible: true, scaleFactor: 1, offset: 0 });
    expect(convertCalls).toEqual([]);
  });
});

describe("collectDisplayUnitsByBase", () => {
  /** Minimal ParameterModel-shaped literal for the helper (fields only). */
  function model(
    fields: Array<{ unit?: string; displayUnit?: string }>,
  ): ParameterModel {
    return {
      className: "T",
      fields: fields.map((f, i) => ({
        name: `p${i}`,
        label: `p${i}`,
        kind: "number" as const,
        value: 0,
        dialog: { tab: "General", group: "Parameters" },
        unitOptions: [],
        ...f,
      })),
    };
  }

  it("maps each base unit to the distinct displayUnits its fields declare", () => {
    const m = model([
      { unit: "rad", displayUnit: "deg" },
      { unit: "rad", displayUnit: "grad" },
      { unit: "rad", displayUnit: "deg" }, // dup → collapsed
      { unit: "K", displayUnit: "degC" },
    ]);
    const map = collectDisplayUnitsByBase(m);
    expect(map.get("rad")).toEqual(["deg", "grad"]);
    expect(map.get("K")).toEqual(["degC"]);
  });

  it("skips fields with no displayUnit, no unit, displayUnit==unit, or dimensionless", () => {
    const m = model([
      { unit: "rad" }, // no displayUnit
      { displayUnit: "deg" }, // no unit
      { unit: "rad", displayUnit: "rad" }, // displayUnit == unit
      { unit: "1", displayUnit: "x" }, // dimensionless base
    ]);
    expect([...collectDisplayUnitsByBase(m).keys()]).toEqual([]);
  });
});

describe("sessionUnitCache (per-client registry)", () => {
  it("returns the SAME cache instance for the same client", () => {
    const { client } = makeClient();
    expect(sessionUnitCache(client)).toBe(sessionUnitCache(client));
  });

  it("returns DISTINCT caches for distinct clients (new OMC session)", () => {
    const a = makeClient().client;
    const b = makeClient().client;
    expect(sessionUnitCache(a)).not.toBe(sessionUnitCache(b));
  });

  it("the per-client cache dedupes across separate panel opens (no re-fetch)", async () => {
    const { client, derivedCalls } = makeClient();
    // Two independent "open panel" cycles reuse the registry's single cache.
    await sessionUnitCache(client).buildUnitTable(["rad"]);
    await sessionUnitCache(client).buildUnitTable(["rad"]);
    expect(derivedCalls).toEqual(["rad"]);
  });
});
