/**
 * Building a class declaration, and resolving which class a
 * `<root>/package.mo` declares — and when that refuses to answer.
 */

import { describe, expect, it, vi } from "vitest";

import {
  classSource,
  declareClass,
  resolveRootPackageParent,
  type DeclareClient,
  type RootPackageClient,
} from "./declare-class.js";

describe("classSource", () => {
  it("writes a multi-word restriction as OMC spells it", () => {
    // `expandable connector` and the operator kinds are two words; splitting
    // or camel-casing them here would not parse.
    expect(classSource({ name: "Bus", kind: "expandable connector" })).toBe(
      "expandable connector Bus\nend Bus;\n",
    );
    expect(
      classSource({
        name: "Add",
        kind: "operator function",
        withinPath: "Lib.Ops",
      }),
    ).toBe("within Lib.Ops;\noperator function Add\nend Add;\n");
  });
});

describe("declareClass", () => {
  function makeClient(options: { success: boolean; errorString?: string }): {
    client: DeclareClient;
    calls: string[];
  } {
    const calls: string[] = [];
    // The diagnostic is left *by* the load, so a fixture that seeded it up
    // front would have it consumed by the pre-call clear instead.
    let buffer = "";
    return {
      calls,
      client: {
        loadString: vi.fn(() => {
          calls.push("loadString");
          buffer = options.errorString ?? "";
          return Promise.resolve({ success: options.success });
        }),
        getErrorString: vi.fn(() => {
          calls.push("getErrorString");
          const errorString = buffer;
          buffer = "";
          return Promise.resolve({ errorString });
        }),
      },
    };
  }

  it("declares a class OMC took, clearing the buffer first and reading it back after", async () => {
    const { client, calls } = makeClient({ success: true });

    await expect(
      declareClass(client, { name: "M", kind: "model" }),
    ).resolves.toEqual({ ok: true, source: "model M\nend M;\n" });
    expect(calls).toEqual(["getErrorString", "loadString", "getErrorString"]);
  });

  it("refuses a load OMC answered success: true but left an error for", async () => {
    // The buffer is the only place a reason lives, so a load answered
    // success for while leaving an error behind is still a refusal.
    const { client } = makeClient({
      success: true,
      errorString: "Error: Class M is already declared in this scope",
    });

    await expect(
      declareClass(client, { name: "M", kind: "model" }),
    ).resolves.toEqual({
      ok: false,
      reason: "Error: Class M is already declared in this scope",
    });
  });

  it("names the class when OMC refuses without saying why", async () => {
    const { client } = makeClient({ success: false });

    await expect(
      declareClass(client, { name: "M", kind: "model", withinPath: "Lib" }),
    ).resolves.toEqual({
      ok: false,
      reason: "OMC refused to create Lib.M",
    });
  });
});

describe("resolveRootPackageParent", () => {
  const ROOT_PKG = "/ws/package.mo";

  function makeClient(
    overrides: {
      parseFile?: ReturnType<typeof vi.fn>;
      getClassInformation?: ReturnType<typeof vi.fn>;
    } = {},
  ): {
    client: RootPackageClient;
    parseFile: ReturnType<typeof vi.fn>;
    getClassInformation: ReturnType<typeof vi.fn>;
  } {
    const parseFile =
      overrides.parseFile ??
      vi.fn(() => Promise.resolve({ classNames: ["RootPkg"] }));
    const getClassInformation =
      overrides.getClassInformation ??
      vi.fn(() => Promise.resolve({ restriction: "package" }));
    return {
      client: { parseFile, getClassInformation },
      parseFile,
      getClassInformation,
    };
  }

  it("resolves the single class a root package.mo declares, once OMC confirms it's loaded", async () => {
    const { client, getClassInformation } = makeClient();

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({ ok: true, parent: "RootPkg" });
    expect(getClassInformation).toHaveBeenCalledWith({ typeName: "RootPkg" });
  });

  it("refuses when the file declares no parseable class", async () => {
    const { client } = makeClient({
      parseFile: vi.fn(() => Promise.resolve({ classNames: [] })),
    });

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: `${ROOT_PKG} declares no class OMC could parse`,
    });
  });

  it("refuses when the file declares more than one top-level class, naming them", async () => {
    const { client } = makeClient({
      parseFile: vi.fn(() => Promise.resolve({ classNames: ["A", "B"] })),
    });

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: `${ROOT_PKG} declares more than one top-level class (A, B)`,
    });
  });

  it("refuses rather than throwing when parseFile itself fails", async () => {
    const { client } = makeClient({
      parseFile: vi.fn(() => Promise.reject(new Error("omc gone"))),
    });

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: `could not read ${ROOT_PKG}'s class name (omc gone)`,
    });
  });

  it("refuses rather than guessing when the resolved class isn't loaded into OMC yet", async () => {
    // parseFile reads straight off disk and never touches OMC's symbol
    // table, so the file can parse cleanly before the class it declares is
    // loaded. OMC 1.27.0 doesn't reject for an unknown
    // class — it answers with every field defaulted, empty `restriction`
    // among them — so that's the signal, not a thrown rejection.
    const { client } = makeClient({
      getClassInformation: vi.fn(() => Promise.resolve({ restriction: "" })),
    });

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason:
        "no class named RootPkg is loaded into OMC yet — wait for the workspace to finish loading and try again",
    });
  });

  it("refuses rather than throwing when the load-confirmation call itself fails", async () => {
    const { client } = makeClient({
      getClassInformation: vi.fn(() => Promise.reject(new Error("omc gone"))),
    });

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: "could not confirm RootPkg is loaded into OMC (omc gone)",
    });
  });
});
