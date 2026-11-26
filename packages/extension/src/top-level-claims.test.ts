import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createTopLevelClaims } from "./top-level-claims.js";

const keptLib = path.resolve("rootA", "Lib", "package.mo");
const refusedLib = path.resolve("rootB", "Lib", "package.mo");

/** `Lib` loaded from rootA, rootB's copy refused. */
function claimsWithRefusedLib() {
  const claims = createTopLevelClaims();
  claims.recordLoad(keptLib, ["Lib"]);
  const collision = claims.refusal(refusedLib, ["Lib"]);
  expect(collision).toEqual({
    className: "Lib",
    keptFileName: keptLib,
    refusedFileName: refusedLib,
  });
  if (collision !== undefined) claims.recordRefusal(collision, ["Lib"]);
  return claims;
}

describe("TopLevelClaims", () => {
  it("lets a class's owner reload it and refuses any other file declaring it", () => {
    const claims = createTopLevelClaims();
    claims.recordLoad(keptLib, ["Lib"]);

    expect(claims.refusal(keptLib, ["Lib"])).toBeUndefined();
    expect(claims.refusal(refusedLib, ["Lib"])?.keptFileName).toBe(keptLib);
    expect(claims.refusal(refusedLib, ["Other"])).toBeUndefined();
  });

  it("refuses every file inside a refused copy's package directory", () => {
    const claims = claimsWithRefusedLib();

    expect(
      claims.refusal(path.resolve("rootB", "Lib", "Sub", "A.mo"), [
        "Lib.Sub.A",
      ]),
    ).toMatchObject({ className: "Lib", keptFileName: keptLib });
    expect(
      claims.refusal(path.resolve("rootA", "Lib", "A.mo"), ["Lib.A"]),
    ).toBeUndefined();
  });

  it("refuses a `within` extension beside a refused copy, not one beside the kept copy", () => {
    const claims = claimsWithRefusedLib();

    expect(
      claims.refusal(path.resolve("rootB", "Ext.mo"), ["Lib.Ext"]),
    ).toMatchObject({ className: "Lib", keptFileName: keptLib });
    expect(
      claims.refusal(path.resolve("rootA", "Ext.mo"), ["Lib.Ext"]),
    ).toBeUndefined();
    expect(
      claims.refusal(path.resolve("rootC", "Ext.mo"), ["Lib.Ext"]),
    ).toBeUndefined();
  });

  it("gives a `within` extension to the closer library when one copy nests inside the other's root", () => {
    const claims = createTopLevelClaims();
    const kept = path.resolve("ws", "Lib", "package.mo");
    const refused = path.resolve("ws", "sub", "Lib.mo");
    claims.recordLoad(kept, ["Lib"]);
    claims.refuse(refused, "Lib");

    expect(
      claims.refusal(path.resolve("ws", "sub", "Ext.mo"), ["Lib.Ext"]),
    ).toBeDefined();
    expect(
      claims.refusal(path.resolve("ws", "Ext.mo"), ["Lib.Ext"]),
    ).toBeUndefined();
  });

  it("drops a class its owner no longer declares on reload", () => {
    const claims = createTopLevelClaims();
    claims.recordLoad(keptLib, ["Lib"]);
    claims.recordLoad(keptLib, ["Renamed"]);

    expect(claims.refusal(refusedLib, ["Lib"])).toBeUndefined();
    expect(claims.refusal(refusedLib, ["Renamed"])).toBeDefined();
  });

  it("frees a class and its refused copies' reach when its owner is released", () => {
    const claims = claimsWithRefusedLib();
    claims.release(keptLib);

    expect(claims.refusal(refusedLib, ["Lib"])).toBeUndefined();
    claims.recordLoad(refusedLib, ["Lib"]);
    expect(
      claims.refusal(path.resolve("rootB", "Lib", "A.mo"), ["Lib.A"]),
    ).toBeUndefined();
  });

  it("forgets every claim and refusal on clear", () => {
    const claims = claimsWithRefusedLib();
    claims.clear();

    expect(claims.refusal(refusedLib, ["Lib"])).toBeUndefined();
    expect(
      claims.refusal(path.resolve("rootB", "Lib", "A.mo"), ["Lib.A"]),
    ).toBeUndefined();
  });

  it("answers a refusal query without recording the refused copy", () => {
    const claims = createTopLevelClaims();
    claims.recordLoad(keptLib, ["Lib"]);

    expect(claims.refusal(refusedLib, ["Lib"])).toBeDefined();

    expect(
      claims.refusal(path.resolve("rootB", "Lib", "A.mo"), ["Lib.A"]),
    ).toBeUndefined();
    expect(claims.refusedCopiesHolding(refusedLib)).toEqual([]);
  });

  it("records a refused copy only for a file declaring the class itself, and reports each file once", () => {
    const claims = claimsWithRefusedLib();
    const ext = path.resolve("rootB", "Ext.mo");
    const collision = claims.refusal(ext, ["Lib.Ext"]);
    if (collision === undefined) throw new Error("expected a collision");

    expect(claims.recordRefusal(collision, ["Lib.Ext"])).toBe(true);
    expect(claims.recordRefusal(collision, ["Lib.Ext"])).toBe(false);
    expect(claims.refusedCopiesHolding(ext)).toEqual([]);
    expect(claims.refusedCopiesHolding(refusedLib)).toEqual([
      { fileName: refusedLib, className: "Lib" },
    ]);
  });

  it("lists the refused copies whose package holds a file", () => {
    const claims = claimsWithRefusedLib();

    expect(
      claims.refusedCopiesHolding(path.resolve("rootB", "Lib", "A.mo")),
    ).toEqual([{ fileName: refusedLib, className: "Lib" }]);
    expect(claims.refusedCopiesHolding(path.resolve("rootB", "A.mo"))).toEqual(
      [],
    );
  });

  it("compares paths through the host's key normalization", () => {
    const claims = createTopLevelClaims((p) => p.toLowerCase());
    claims.recordLoad(keptLib, ["Lib"]);

    expect(claims.refusal(keptLib.toUpperCase(), ["Lib"])).toBeUndefined();
    expect(claims.refusal(refusedLib, ["Lib"])).toBeDefined();
  });

  describe("held for a sweep", () => {
    it("keeps a load recorded before the sweep settles from refusing anything", () => {
      const claims = createTopLevelClaims();
      const sweep = claims.holdForSweep();
      claims.recordLoad(refusedLib, ["Lib"]);

      expect(claims.refusal(keptLib, ["Lib"])).toBeUndefined();
      expect(sweep.refusal(keptLib, ["Lib"])).toBeUndefined();
    });

    it("lets the sweep's load displace a provisional owner, which becomes a refused copy", () => {
      const claims = createTopLevelClaims();
      const sweep = claims.holdForSweep();
      claims.recordLoad(refusedLib, ["Lib"]);

      sweep.recordLoad(keptLib, ["Lib"]);
      sweep.done();

      expect(claims.refusal(refusedLib, ["Lib"])?.keptFileName).toBe(keptLib);
      expect(claims.refusedCopiesHolding(refusedLib)).toEqual([
        { fileName: refusedLib, className: "Lib" },
      ]);
    });

    it("makes provisional claims stand once every held sweep is done", () => {
      const claims = createTopLevelClaims();
      const first = claims.holdForSweep();
      const second = claims.holdForSweep();
      claims.recordLoad(keptLib, ["Lib"]);

      first.done();
      first.done();
      expect(claims.refusal(refusedLib, ["Lib"])).toBeUndefined();

      second.done();
      expect(claims.refusal(refusedLib, ["Lib"])?.keptFileName).toBe(keptLib);
    });
  });
});
