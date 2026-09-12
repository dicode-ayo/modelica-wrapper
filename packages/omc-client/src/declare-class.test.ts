/**
 * The root-package resolver: which class a `<root>/package.mo` declares, and
 * when it refuses to answer.
 */

import { describe, expect, it, vi } from "vitest";

import { classSource, resolveRootPackageParent } from "./declare-class.js";

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

describe("resolveRootPackageParent", () => {
  const ROOT_PKG = "/ws/package.mo";

  function makeClient(
    overrides: {
      parseFile?: ReturnType<typeof vi.fn>;
      getClassInformation?: ReturnType<typeof vi.fn>;
    } = {},
  ): {
    client: Parameters<typeof resolveRootPackageParent>[0];
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
      client: { parseFile, getClassInformation } as unknown as Parameters<
        typeof resolveRootPackageParent
      >[0],
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
    // table — workspace autoload (workspace-autoload.ts) loads entry files
    // asynchronously, so the file can parse cleanly before OMC has actually
    // loaded the class it declares. OMC 1.27.0 doesn't reject for an unknown
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
