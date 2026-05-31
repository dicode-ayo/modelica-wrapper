/**
 * Unit tests for the pure go-to-definition core (`computeDefinition`).
 *
 * No `vscode`, no live OMC: real fixture trees from the vendored grammar WASM
 * (mirrors `cursor.test.ts`) drive the cursor classifier, and the OMC surface is
 * a plain mock (mirrors `resolve.test.ts`). The `vscode.DefinitionProvider`
 * wrapper is a thin shell over this — `computeDefinition` resolves the
 * target's qualified name, and the wrapper turns it into a `modelica-source:`
 * URI (covered end-to-end by `definition-hover.spec.ts`).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { computeDefinition } from "./definition-provider.js";
import { GRAMMAR_WASM_FILENAME } from "./parse.js";
import type { ResolveClient } from "./resolve.js";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = join(here, "..", "..", "grammar", GRAMMAR_WASM_FILENAME);

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function parse(src: string): Tree {
  const tree = parser.parse(src);
  if (!tree) throw new Error("parser returned no tree");
  return tree;
}

/** Offset of the (occurrence-th) literal `needle` in `src`. */
function offsetOf(src: string, needle: string, occurrence = 0): number {
  let from = -1;
  let idx = -1;
  for (let k = 0; k <= occurrence; k++) {
    idx = src.indexOf(needle, from + 1);
    if (idx === -1) throw new Error(`needle not found: ${needle}#${occurrence}`);
    from = idx;
  }
  return idx;
}

/** A ResolveClient with overridable behavior (mirrors resolve.test.ts). */
function makeClient(overrides: Partial<ResolveClient> = {}): ResolveClient {
  return {
    qualifyPath: vi.fn(({ path }) => Promise.resolve({ qualifiedPath: path })),
    getClassInformation: vi.fn(() => Promise.resolve({ fileName: "/lib/Unknown.mo" })),
    getComponents: vi.fn(() => Promise.resolve({ components: [] })),
    ...overrides,
  };
}

describe("computeDefinition — class/type reference", () => {
  it("resolves a component type to its fully-qualified class name", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      qualifyPath: vi.fn(() =>
        Promise.resolve({ qualifiedPath: "Modelica.Electrical.Resistor" }),
      ),
    });

    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    expect(client.qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.Circuit",
      path: "Resistor",
    });
    expect(site).toEqual({ qualifiedName: "Modelica.Electrical.Resistor" });
  });

  it("resolves an extends target", async () => {
    const src = "model Derived\n  extends Base;\nend Derived;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Pkg.Base" })),
    });

    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Base") + 1,
      "Pkg.Derived",
      client,
    );

    expect(site).toEqual({ qualifiedName: "Pkg.Base" });
  });

  it("resolves a dotted type using the path up to the cursor", async () => {
    const src = "model M\n  Modelica.Electrical.Resistor r;\nend M;";
    const qualifyPath = vi.fn(({ path }) =>
      Promise.resolve({ qualifiedPath: path }),
    );
    const client = makeClient({ qualifyPath });

    await computeDefinition(
      parse(src),
      offsetOf(src, "Electrical") + 1,
      "Pkg.A",
      client,
    );
    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "Pkg.A",
      path: "Modelica.Electrical",
    });
  });
});

describe("computeDefinition — member cref", () => {
  it("resolves a member access to its declared type's qualified name", async () => {
    const src = "model M\nequation\n  y = r.v;\nend M;";
    const getComponents = vi.fn(({ typeName }) => {
      if (typeName === "MyPkg.M") {
        return Promise.resolve({
          components: [{ name: "r", className: "Pkg.Resistor" }],
        });
      }
      if (typeName === "Pkg.Resistor") {
        return Promise.resolve({
          components: [{ name: "v", className: "Modelica.SIunits.Voltage" }],
        });
      }
      return Promise.resolve({ components: [] });
    });
    const client = makeClient({ getComponents });

    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "v;"),
      "MyPkg.M",
      client,
    );

    expect(site).toEqual({ qualifiedName: "Modelica.SIunits.Voltage" });
  });
});

describe("computeDefinition — unresolved", () => {
  it("returns undefined when the cursor is not on an identifier", async () => {
    const src = "model M\n  Resistor r;\nend M;";
    const client = makeClient();
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "model"),
      "Pkg.M",
      client,
    );
    expect(site).toBeUndefined();
  });

  it("returns undefined for a plain value reference", async () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const client = makeClient();
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "x;"),
      "Pkg.M",
      client,
    );
    expect(site).toBeUndefined();
    expect(client.qualifyPath).not.toHaveBeenCalled();
  });

  it("returns undefined when the class has no source file (built-in)", async () => {
    const src = "model M\n  Real x;\nend M;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Real" })),
      getClassInformation: vi.fn(() => Promise.resolve({ fileName: "" })),
    });
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Real") + 1,
      "Pkg.M",
      client,
    );
    expect(site).toBeUndefined();
  });

  it("navigates an interactively-defined class via the virtual scheme", async () => {
    // The existence probe accepts any non-empty `fileName` OMC returns —
    // including the `<interactive>` pseudo-path for interactively-defined
    // classes, which `modelica-source:` then opens via `list(<FQN>)`.
    const src = "model M\n  Resistor r;\nend M;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Resistor" })),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileName: "<interactive>" }),
      ),
    });
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "Pkg.M",
      client,
    );
    expect(site).toEqual({ qualifiedName: "Resistor" });
  });

  it("returns undefined when OMC throws (graceful degradation)", async () => {
    const src = "model M\n  Resistor r;\nend M;";
    const client = makeClient({
      getClassInformation: vi.fn(() => Promise.reject(new Error("boom"))),
    });
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "Pkg.M",
      client,
    );
    expect(site).toBeUndefined();
  });

  it("returns undefined (does not throw) when qualifyPath throws", async () => {
    // The resolution layer must swallow a qualifyPath throw into no-result, so
    // the pure core degrades gracefully rather than throwing out.
    const src = "model M\n  Resistor r;\nend M;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.reject(new Error("omc qualify failed"))),
    });
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "Pkg.M",
      client,
    );
    expect(site).toBeUndefined();
  });
});

describe("computeDefinition — malformed / empty buffers", () => {
  it("returns undefined for an empty buffer (no throw)", async () => {
    const client = makeClient();
    await expect(
      computeDefinition(parse(""), 0, "Pkg.M", client),
    ).resolves.toBeUndefined();
  });

  it("does not throw on a malformed, partially-typed buffer", async () => {
    // Unterminated declaration with the cursor mid-type — tree-sitter returns a
    // tree with error nodes; resolution must degrade, never throw.
    const src = "model M\n  Resis";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.reject(new Error("unloadable"))),
    });
    const site = await computeDefinition(
      parse(src),
      offsetOf(src, "Resis") + 1,
      "Pkg.M",
      client,
    );
    expect(site).toBeUndefined();
  });

  it("does not throw when the cursor is past the end of a malformed buffer", async () => {
    const src = "model M\n  Real x(";
    const client = makeClient();
    await expect(
      computeDefinition(parse(src), src.length, "Pkg.M", client),
    ).resolves.toBeUndefined();
  });
});
