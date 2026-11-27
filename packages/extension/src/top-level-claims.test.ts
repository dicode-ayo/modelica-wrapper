import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

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
    claims.refuse(refused, "Lib", kept);

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
      { fileName: refusedLib, className: "Lib", keptFileName: keptLib },
    ]);
  });

  it("lists the refused copies whose package holds a file", () => {
    const claims = claimsWithRefusedLib();

    expect(
      claims.refusedCopiesHolding(path.resolve("rootB", "Lib", "A.mo")),
    ).toEqual([
      { fileName: refusedLib, className: "Lib", keptFileName: keptLib },
    ]);
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

  it("compares a refused copy's package through the host's key normalization", () => {
    const claims = createTopLevelClaims((p) => p.toLowerCase());
    const copy = {
      fileName: refusedLib,
      className: "Lib",
      keptFileName: keptLib,
    };

    expect(claims.copyHolds(copy, path.resolve("rootB", "LIB", "Sub.mo"))).toBe(
      true,
    );
    expect(claims.copyHolds(copy, path.resolve("rootB", "Ext.mo"))).toBe(false);
  });

  it("claims top-level classes only, so a moved member file is never refused against its old path", () => {
    const claims = createTopLevelClaims();
    claims.recordLoad(path.resolve("rootA", "Lib", "A", "Foo.mo"), [
      "Lib.A.Foo",
    ]);

    expect(
      claims.refusal(path.resolve("rootA", "Lib", "A", "Bar.mo"), [
        "Lib.A.Foo",
      ]),
    ).toBeUndefined();
  });

  it("keeps refusing a file refused by path for a nested class until its kept file goes", () => {
    const claims = createTopLevelClaims();
    const keptExt = path.resolve("rootA", "Ext.mo");
    const refusedExt = path.resolve("rootB", "Ext.mo");
    claims.refuse(refusedExt, "Lib.Ext", keptExt);

    expect(claims.refusal(refusedExt, ["Lib.Ext"])).toEqual({
      className: "Lib.Ext",
      keptFileName: keptExt,
      refusedFileName: refusedExt,
    });
    expect(claims.refusal(refusedExt, ["Lib.Other"])).toBeUndefined();

    claims.release(keptExt);
    expect(claims.refusal(refusedExt, ["Lib.Ext"])).toBeUndefined();
  });

  it("returns the refused copies of a released owner's class", () => {
    const claims = claimsWithRefusedLib();

    expect(claims.release(keptLib)).toEqual([
      { fileName: refusedLib, className: "Lib", keptFileName: keptLib },
    ]);
  });

  describe("reservations", () => {
    it("refuses a racing copy while a reservation is open, and frees the class on cancel", () => {
      const claims = createTopLevelClaims();
      const reservation = claims.reserve(keptLib, ["Lib"]);

      expect(claims.refusal(refusedLib, ["Lib"])?.keptFileName).toBe(keptLib);

      reservation.cancel();
      expect(claims.refusal(refusedLib, ["Lib"])).toBeUndefined();
    });

    it("drops the refusals recorded against a reservation it cancels", () => {
      const claims = createTopLevelClaims();
      const reservation = claims.reserve(keptLib, ["Lib"]);
      const collision = claims.refusal(refusedLib, ["Lib"]);
      if (collision === undefined) throw new Error("expected a collision");
      claims.recordRefusal(collision, ["Lib"]);

      reservation.cancel();

      expect(claims.refusal(refusedLib, ["Lib"])).toBeUndefined();
      expect(
        claims.refusal(path.resolve("rootB", "Lib", "A.mo"), ["Lib.A"]),
      ).toBeUndefined();
      expect(claims.recordRefusal(collision, [])).toBe(true);
    });

    it("leaves a later load of the same file committed when an earlier reservation cancels", () => {
      const claims = createTopLevelClaims();
      const first = claims.reserve(keptLib, ["Lib"]);
      const second = claims.reserve(keptLib, ["Lib"]);

      second.commit();
      first.cancel();

      expect(claims.refusal(refusedLib, ["Lib"])?.keptFileName).toBe(keptLib);
    });

    it("commits a reservation as a load, giving up classes no longer declared", () => {
      const claims = createTopLevelClaims();
      claims.recordLoad(keptLib, ["Old"]);

      claims.reserve(keptLib, ["Lib"]).commit();

      expect(claims.refusal(refusedLib, ["Lib"])).toBeDefined();
      expect(claims.refusal(refusedLib, ["Old"])).toBeUndefined();
    });

    it("leaves an owner's own claim in place when its cancelled reload reserved nothing new", () => {
      const claims = createTopLevelClaims();
      claims.recordLoad(keptLib, ["Lib"]);

      claims.reserve(keptLib, ["Lib"]).cancel();

      expect(claims.refusal(refusedLib, ["Lib"])).toBeDefined();
    });
  });

  describe("hold", () => {
    it("settles once every hold is released, each release counting once", async () => {
      const claims = createTopLevelClaims();
      const first = claims.hold();
      const second = claims.hold();
      let settled = false;
      void claims.settled().then(() => {
        settled = true;
      });

      first();
      first();
      await Promise.resolve();
      expect(settled).toBe(false);

      second();
      await vi.waitFor(() => expect(settled).toBe(true));
    });
  });
});
