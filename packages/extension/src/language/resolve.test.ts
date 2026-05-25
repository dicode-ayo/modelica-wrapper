/**
 * Unit tests for the OMC resolution layer. The OMC surface is a plain mock — no
 * live OMC.
 */

import { describe, expect, it, vi } from "vitest";

import type { CursorContextKind } from "./cursor.js";
import { resolve, type ResolveClient, type ResolveTarget } from "./resolve.js";

function target(
  context: CursorContextKind,
  pathToCursor: string[],
): ResolveTarget {
  return { context, pathToCursor };
}

function makeClient(overrides: Partial<ResolveClient> = {}): ResolveClient {
  return {
    qualifyPath: vi.fn(({ path }) => Promise.resolve({ qualifiedPath: path })),
    getClassInformation: vi.fn(() => Promise.resolve({ fileName: "/lib/Unknown.mo" })),
    getComponents: vi.fn(() => Promise.resolve({ components: [] })),
    ...overrides,
  };
}

describe("resolve — class/type reference", () => {
  it("qualifies the name in the owning scope and reports the FQN", async () => {
    const qualifyPath = vi.fn(() =>
      Promise.resolve({
        qualifiedPath: "Modelica.Electrical.Analog.Basic.Resistor",
      }),
    );
    const client = makeClient({ qualifyPath });

    const result = await resolve(
      "MyPkg.Circuit",
      target("component-type", ["Resistor"]),
      client,
    );

    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.Circuit",
      path: "Resistor",
    });
    expect(client.getClassInformation).toHaveBeenCalledWith({
      typeName: "Modelica.Electrical.Analog.Basic.Resistor",
    });
    expect(result).toEqual({
      qualifiedName: "Modelica.Electrical.Analog.Basic.Resistor",
    });
  });

  it("joins a dotted type path before qualifying", async () => {
    const qualifyPath = vi.fn(({ path }) =>
      Promise.resolve({ qualifiedPath: path }),
    );
    const client = makeClient({ qualifyPath });

    await resolve(
      "Pkg.A",
      target("type-reference", ["Modelica", "Blocks", "Math"]),
      client,
    );
    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "Pkg.A",
      path: "Modelica.Blocks.Math",
    });
  });

  it("resolves `extends` targets", async () => {
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Pkg.Base" })),
    });
    const result = await resolve(
      "Pkg.Derived",
      target("extends", ["Base"]),
      client,
    );
    expect(result).toEqual({ qualifiedName: "Pkg.Base" });
  });

  it("returns undefined when the class has no source file (built-in)", async () => {
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Real" })),
      getClassInformation: vi.fn(() => Promise.resolve({ fileName: "" })),
    });
    const result = await resolve("Pkg.A", target("component-type", ["Real"]), client);
    expect(result).toBeUndefined();
  });

  it("returns undefined when getClassInformation throws", async () => {
    const client = makeClient({
      getClassInformation: vi.fn(() => Promise.reject(new Error("no such class"))),
    });
    const result = await resolve("Pkg.A", target("type-reference", ["Nope"]), client);
    expect(result).toBeUndefined();
  });

  it("returns undefined (does not throw) when qualifyPath throws", async () => {
    // OMC can throw on a malformed/partially-typed name or an unloaded scope;
    // the resolver must swallow it into no-result, not let it escape the layer.
    const getClassInformation = vi.fn();
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.reject(new Error("qualify failed"))),
      getClassInformation,
    });
    const result = await resolve(
      "Pkg.A",
      target("type-reference", ["Half"]),
      client,
    );
    expect(result).toBeUndefined();
    // It should bail at qualify, never reaching getClassInformation.
    expect(getClassInformation).not.toHaveBeenCalled();
  });
});

describe("resolve — member cref", () => {
  it("resolves head component → type → member type definition", async () => {
    // resistor.R: `resistor` is a Resistor in the owning class; `R` is a
    // Modelica.SIunits.Resistance inside Resistor.
    const getComponents = vi.fn(({ typeName }) => {
      if (typeName === "MyPkg.Circuit") {
        return Promise.resolve({
          components: [
            { name: "resistor", className: "Modelica.Electrical.Basic.Resistor" },
            { name: "ground", className: "Modelica.Electrical.Basic.Ground" },
          ],
        });
      }
      if (typeName === "Modelica.Electrical.Basic.Resistor") {
        return Promise.resolve({
          components: [
            { name: "R", className: "Modelica.SIunits.Resistance" },
            { name: "T", className: "Modelica.SIunits.Temperature" },
          ],
        });
      }
      return Promise.resolve({ components: [] });
    });
    const client = makeClient({ getComponents });

    const result = await resolve(
      "MyPkg.Circuit",
      target("member-access", ["resistor", "R"]),
      client,
    );

    expect(getComponents).toHaveBeenNthCalledWith(1, { typeName: "MyPkg.Circuit" });
    expect(getComponents).toHaveBeenNthCalledWith(2, {
      typeName: "Modelica.Electrical.Basic.Resistor",
    });
    expect(client.getClassInformation).toHaveBeenCalledWith({
      typeName: "Modelica.SIunits.Resistance",
    });
    expect(result).toEqual({ qualifiedName: "Modelica.SIunits.Resistance" });
  });

  it("walks a 3-segment cref through each segment's type", async () => {
    // `a.b.c`: must visit `b` in A's type and `c` in B's type — not `c` in A.
    const getComponents = vi.fn(({ typeName }) => {
      switch (typeName) {
        case "MyPkg.Top":
          return Promise.resolve({
            components: [{ name: "a", className: "Pkg.A" }],
          });
        case "Pkg.A":
          return Promise.resolve({
            components: [
              { name: "b", className: "Pkg.B" },
              // A's own `c` must NOT be picked up; final lookup must go via B.
              { name: "c", className: "Pkg.WrongC" },
            ],
          });
        case "Pkg.B":
          return Promise.resolve({
            components: [{ name: "c", className: "Pkg.C" }],
          });
        default:
          return Promise.resolve({ components: [] });
      }
    });
    const client = makeClient({ getComponents });

    const result = await resolve(
      "MyPkg.Top",
      target("member-access", ["a", "b", "c"]),
      client,
    );

    // The container of the final member is B's type, not A's — so the resolved
    // member type is Pkg.C (via B), never Pkg.WrongC (A's own `c`).
    expect(client.getClassInformation).toHaveBeenCalledWith({ typeName: "Pkg.C" });
    expect(result).toEqual({ qualifiedName: "Pkg.C" });
  });

  it("returns undefined when an intermediate segment can't be walked", async () => {
    // `b` missing inside A's type: unresolved, not "skip to `c` in A".
    const getComponents = vi.fn(({ typeName }) =>
      typeName === "MyPkg.Top"
        ? Promise.resolve({ components: [{ name: "a", className: "Pkg.A" }] })
        : Promise.resolve({ components: [] }),
    );
    const client = makeClient({ getComponents });
    const result = await resolve(
      "MyPkg.Top",
      target("member-access", ["a", "b", "c"]),
      client,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for an inherited member (extends not walked)", async () => {
    // `getComponents` reports only own declared components, not `extends`-pulled ones.
    const getComponents = vi.fn(({ typeName }) =>
      typeName === "MyPkg.Circuit"
        ? Promise.resolve({
            components: [{ name: "resistor", className: "Pkg.Resistor" }],
          })
        : Promise.resolve({ components: [] }),
    );
    const client = makeClient({ getComponents });
    const result = await resolve(
      "MyPkg.Circuit",
      target("member-access", ["resistor", "inheritedPin"]),
      client,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the head component is unknown", async () => {
    const client = makeClient({
      getComponents: vi.fn(() => Promise.resolve({ components: [] })),
    });
    const result = await resolve(
      "MyPkg.Circuit",
      target("member-access", ["ghost", "x"]),
      client,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when the member is not found in the head's type", async () => {
    const getComponents = vi.fn(({ typeName }) =>
      typeName === "MyPkg.Circuit"
        ? Promise.resolve({
            components: [{ name: "resistor", className: "Pkg.Resistor" }],
          })
        : Promise.resolve({ components: [{ name: "R", className: "Real" }] }),
    );
    const client = makeClient({ getComponents });
    const result = await resolve(
      "MyPkg.Circuit",
      target("member-access", ["resistor", "missing"]),
      client,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for a single-segment member path", async () => {
    const client = makeClient();
    const result = await resolve(
      "MyPkg.Circuit",
      target("member-access", ["resistor"]),
      client,
    );
    expect(result).toBeUndefined();
  });
});

describe("resolve — non-resolvable contexts", () => {
  it("returns undefined for a plain component reference", async () => {
    const client = makeClient();
    const result = await resolve(
      "Pkg.A",
      target("component-reference", ["x"]),
      client,
    );
    expect(result).toBeUndefined();
    expect(client.qualifyPath).not.toHaveBeenCalled();
  });

  it("returns undefined for a modifier name", async () => {
    const client = makeClient();
    expect(
      await resolve("Pkg.A", target("modifier-name", ["R"]), client),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown context", async () => {
    const client = makeClient();
    expect(
      await resolve("Pkg.A", target("unknown", ["whatever"]), client),
    ).toBeUndefined();
  });
});
