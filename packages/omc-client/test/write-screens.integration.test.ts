/**
 * Writes OMC answers `true` for while corrupting or discarding the model:
 * a duplicate connection, a connection to an undeclared component, a
 * connection into a class that is not loaded, and a class created over one
 * that already exists. Each wrapper must refuse, and the model must read
 * back unchanged.
 */

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { declareClass } from "../src/declare-class.js";

import { describeIf } from "./fixtures.js";

describeIf("pre-write screens against corrupting writes (real OMC)", () => {
  let client: OmcClient;
  let pkg: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    pkg = `MwScreen_${randomBytes(4).toString("hex")}`;
    const { success } = await client.loadString({
      data: `package ${pkg}
  connector C Real e; flow Real f; end C;
  expandable connector Bus end Bus;
  model Base C a; C c; equation connect(a, c); end Base;
  model M
    extends Base;
    C b;
    C arr[3];
    Bus bus;
  equation
    connect(a, b);
  end M;
  model Broken
    C x;
    C y;
  equation
    connect(x.e, y.e);
  end Broken;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`fixture failed to load: ${errorString}`);
    }
  });

  afterEach(async () => {
    try {
      await client.deleteClass({ typeName: pkg });
    } catch {
      // OMC closing; nothing to clean up.
    }
    await client.close();
  });

  const source = async (typeName: string): Promise<string> =>
    (await client.listFile({ typeName })).contents;

  it("refuses a connection the class already has, in either orientation", async () => {
    const before = await source(`${pkg}.M`);
    for (const [from, to] of [
      ["a", "b"],
      ["b", "a"],
    ] as const) {
      const out = await client.addConnection({
        from,
        to,
        typeName: `${pkg}.M`,
      });
      expect(out.success).toBe(false);
    }
    expect(await source(`${pkg}.M`)).toBe(before);
  });

  it("refuses a connection a base class already makes", async () => {
    const before = await source(`${pkg}.M`);
    const out = await client.addConnection({
      from: "c",
      to: "a",
      typeName: `${pkg}.M`,
    });
    expect(out.success).toBe(false);
    expect(await source(`${pkg}.M`)).toBe(before);
  });

  it("still writes into a class that already holds an invalid connection", async () => {
    // getConnectionList fails on such a class ("x.e is not a valid
    // connector"); the screen must not depend on it.
    const out = await client.addConnection({
      from: "x",
      to: "y",
      typeName: `${pkg}.Broken`,
    });
    expect(out.success).toBe(true);
    expect(
      await client.getConnectionCount({ typeName: `${pkg}.Broken` }),
    ).toEqual({ count: 2 });
  });

  it("refuses a connection whose components the class does not declare", async () => {
    const before = await source(`${pkg}.M`);
    const out = await client.addConnection({
      from: "nope",
      to: "zz",
      typeName: `${pkg}.M`,
    });
    expect(out).toEqual({
      success: false,
      diagnostic: `${pkg}.M declares no component named nope`,
    });
    expect(await source(`${pkg}.M`)).toBe(before);
  });

  it("refuses a connection into a class that is not loaded", async () => {
    const out = await client.addConnection({
      from: "a",
      to: "b",
      typeName: `${pkg}.Missing`,
    });
    expect(out).toEqual({
      success: false,
      diagnostic: `${pkg}.Missing is not a loaded class`,
    });
  });

  it("writes a connection to an inherited component, an array element and a bus member", async () => {
    const out = await client.addConnection({
      from: "arr[2]",
      to: "a",
      typeName: `${pkg}.M`,
    });
    expect(out.success).toBe(true);
    const bus = await client.addConnection({
      from: "bus.undeclaredSignal",
      to: "b",
      typeName: `${pkg}.M`,
    });
    expect(bus.success).toBe(true);
    const { result } = await client.getConnectionList({
      typeName: `${pkg}.M`,
    });
    expect(result.map((c) => [c.from, c.to])).toEqual(
      expect.arrayContaining([
        ["arr[2]", "a"],
        ["bus.undeclaredSignal", "b"],
      ]),
    );
  });

  it("refuses newModel over a model that already exists", async () => {
    const before = await source(`${pkg}.M`);
    const out = await client.newModel({ typeName: "M", withinPath: pkg });
    expect(out.success).toBe(false);
    expect(await source(`${pkg}.M`)).toBe(before);
  });

  it("refuses declareClass over a nested class that already exists", async () => {
    const before = await source(`${pkg}.M`);
    const out = await declareClass(client, {
      name: "M",
      kind: "model",
      withinPath: pkg,
    });
    expect(out.ok).toBe(false);
    expect(await source(`${pkg}.M`)).toBe(before);
  });

  it("refuses declareClass over a top-level package that already exists", async () => {
    const before = await source(pkg);
    const out = await declareClass(client, { name: pkg, kind: "model" });
    expect(out.ok).toBe(false);
    expect(await source(pkg)).toBe(before);
  });
});
