/**
 * Unit tests for the OMC resolution layer. The OMC surface is a plain mock — no
 * live OMC. Coordinate conversion (OMC 1-based → VSCode 0-based) is asserted
 * here too, since it is the resolver's externally-visible contract.
 */

import { describe, expect, it, vi } from "vitest";

import type { CursorContextKind, CursorTarget } from "./cursor.js";
import { resolve, type ResolveClient } from "./resolve.js";

/** Build a minimal CursorTarget; the resolver only reads context + pathToCursor. */
function target(
  context: CursorContextKind,
  pathToCursor: string[],
): CursorTarget {
  const path = pathToCursor;
  return {
    identifier: pathToCursor[pathToCursor.length - 1] ?? "",
    path,
    pathToCursor,
    context,
    startIndex: 0,
    endIndex: 0,
  };
}

/** A ResolveClient with overridable behaviour and call recording. */
function makeClient(overrides: Partial<ResolveClient> = {}): ResolveClient {
  return {
    qualifyPath: vi.fn(({ path }) => Promise.resolve({ qualifiedPath: path })),
    getClassInformation: vi.fn(() =>
      Promise.resolve({
        fileName: "/lib/Unknown.mo",
        lineNumberStart: 1,
        columnNumberStart: 1,
      }),
    ),
    getComponents: vi.fn(() => Promise.resolve({ components: [] })),
    ...overrides,
  };
}

describe("resolve — class/type reference", () => {
  it("qualifies the name in the owning scope and reads its location (1→0 based)", async () => {
    const qualifyPath = vi.fn(() =>
      Promise.resolve({
        qualifiedPath: "Modelica.Electrical.Analog.Basic.Resistor",
      }),
    );
    const getClassInformation = vi.fn(() =>
      Promise.resolve({
        fileName: "/msl/Resistor.mo",
        lineNumberStart: 12,
        columnNumberStart: 3,
      }),
    );
    const client = makeClient({ qualifyPath, getClassInformation });

    const result = await resolve(
      "MyPkg.Circuit",
      target("component-type", ["Resistor"]),
      client,
    );

    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.Circuit",
      path: "Resistor",
    });
    expect(getClassInformation).toHaveBeenCalledWith({
      typeName: "Modelica.Electrical.Analog.Basic.Resistor",
    });
    expect(result).toEqual({
      qualifiedName: "Modelica.Electrical.Analog.Basic.Resistor",
      fileName: "/msl/Resistor.mo",
      // OMC (12, 3) 1-based → VSCode (11, 2) 0-based.
      line: 11,
      column: 2,
    });
  });

  it("joins a dotted type path before qualifying", async () => {
    const qualifyPath = vi.fn(({ path }) =>
      Promise.resolve({ qualifiedPath: path }),
    );
    const client = makeClient({
      qualifyPath,
      getClassInformation: vi.fn(() =>
        Promise.resolve({
          fileName: "/x.mo",
          lineNumberStart: 1,
          columnNumberStart: 1,
        }),
      ),
    });

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
      qualifyPath: vi.fn(() =>
        Promise.resolve({ qualifiedPath: "Pkg.Base" }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({
          fileName: "/pkg/Base.mo",
          lineNumberStart: 5,
          columnNumberStart: 1,
        }),
      ),
    });
    const result = await resolve("Pkg.Derived", target("extends", ["Base"]), client);
    expect(result?.qualifiedName).toBe("Pkg.Base");
    expect(result?.line).toBe(4);
  });

  it("returns undefined when the class has no source file (built-in)", async () => {
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Real" })),
      getClassInformation: vi.fn(() =>
        Promise.resolve({
          fileName: "",
          lineNumberStart: 0,
          columnNumberStart: 0,
        }),
      ),
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
});

describe("resolve — member cref (one hop)", () => {
  it("resolves head component → type → member type definition", async () => {
    // resistor.R : resistor is a Resistor in the owning class; R is a
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
    const getClassInformation = vi.fn(() =>
      Promise.resolve({
        fileName: "/msl/SIunits.mo",
        lineNumberStart: 200,
        columnNumberStart: 5,
      }),
    );
    const client = makeClient({ getComponents, getClassInformation });

    const result = await resolve(
      "MyPkg.Circuit",
      target("member-access", ["resistor", "R"]),
      client,
    );

    expect(getComponents).toHaveBeenNthCalledWith(1, { typeName: "MyPkg.Circuit" });
    expect(getComponents).toHaveBeenNthCalledWith(2, {
      typeName: "Modelica.Electrical.Basic.Resistor",
    });
    expect(getClassInformation).toHaveBeenCalledWith({
      typeName: "Modelica.SIunits.Resistance",
    });
    expect(result).toEqual({
      qualifiedName: "Modelica.Electrical.Basic.Resistor.R",
      fileName: "/msl/SIunits.mo",
      line: 199,
      column: 4,
    });
  });

  it("walks a 3-segment cref through each segment's type", async () => {
    // a.b.c : `a` is an A in the owning class; `b` is a B inside A; `c` is a
    // C inside B. The walk must visit `b` in A and `c` in B — NOT `c` in A.
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
              // A also has its own `c`; resolving `a.b.c` must NOT pick this up.
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
    const getClassInformation = vi.fn(() =>
      Promise.resolve({
        fileName: "/pkg/C.mo",
        lineNumberStart: 7,
        columnNumberStart: 2,
      }),
    );
    const client = makeClient({ getComponents, getClassInformation });

    const result = await resolve(
      "MyPkg.Top",
      target("member-access", ["a", "b", "c"]),
      client,
    );

    // The container of the final member is B's type, not A's — so the resolved
    // member type is Pkg.C (via B), never Pkg.WrongC (A's own `c`).
    expect(getClassInformation).toHaveBeenCalledWith({ typeName: "Pkg.C" });
    expect(result).toEqual({
      qualifiedName: "Pkg.B.c",
      fileName: "/pkg/C.mo",
      line: 6,
      column: 1,
    });
  });

  it("returns undefined when an intermediate segment can't be walked", async () => {
    // a.b.c where `b` does not exist inside A's type → unresolved, not a wrong
    // answer reached by skipping `b`.
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

  it("returns undefined for an inherited member (v1 limitation, pinned)", async () => {
    // `getComponents` reports only a class's OWN declared components, not those
    // pulled in via `extends`. So a member inherited from a base class is not
    // found and resolves to undefined. This pins the documented v1 gap; when
    // inheritance walking lands this test should flip to a positive assertion.
    const getComponents = vi.fn(({ typeName }) =>
      typeName === "MyPkg.Circuit"
        ? Promise.resolve({
            components: [{ name: "resistor", className: "Pkg.Resistor" }],
          })
        : // Pkg.Resistor declares nothing of its own; `inheritedPin` would only
          // be visible after walking its `extends` clause, which v1 does not do.
          Promise.resolve({ components: [] }),
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
