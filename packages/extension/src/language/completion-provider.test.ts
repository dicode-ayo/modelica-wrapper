/**
 * Unit tests for the pure completion core (`computeCompletions`).
 *
 * No `vscode`, no live OMC: real fixture trees from the vendored grammar WASM
 * (mirrors `definition-provider.test.ts` / `cursor.test.ts`) drive the cursor
 * classifier, and the OMC surface is a plain mock (mirrors `resolve.test.ts`).
 * The `vscode.CompletionItemProvider` wrapper is a thin shell over this, so
 * testing the core covers the context→source routing.
 *
 * Each test asserts the ROUTING: which typed wrapper(s) the context calls, with
 * which args, and what kinds the candidates carry — not just the labels.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  CompletionCandidateKind,
  computeCompletions,
  MAX_COMPLETIONS,
  MIN_FUZZY_PREFIX,
  type CompletionClient,
} from "./completion-provider.js";
import { GRAMMAR_WASM_FILENAME } from "./parse.js";

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

/** A CompletionClient with overridable behaviour and call recording. */
function makeClient(overrides: Partial<CompletionClient> = {}): CompletionClient {
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
    getClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
    searchClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
    getParameterNames: vi.fn(() => Promise.resolve({ parameters: [] })),
    isPackage: vi.fn(() => Promise.resolve({ b: false })),
    ...overrides,
  };
}

describe("computeCompletions — type / extends / component-type position", () => {
  it("routes a component-type position to getClassNames(scope) + searchClassNames(prefix)", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Ground", "Capacitor"] }),
      ),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    // getClassNames is called on the enclosing scope (the owning class).
    expect(client.getClassNames).toHaveBeenCalledWith({
      typeName: "MyPkg.Circuit",
    });
    // searchClassNames is called with the typed prefix (the identifier).
    expect(client.searchClassNames).toHaveBeenCalledWith({
      searchText: "Resistor",
    });
    // member/parameter sources are NOT touched in a type position.
    expect(client.getComponents).not.toHaveBeenCalled();
    expect(client.getParameterNames).not.toHaveBeenCalled();

    const labels = out.map((c) => c.label);
    expect(labels).toContain("Ground");
    expect(labels).toContain("Modelica.Electrical.Resistor");
    expect(out.every((c) => c.kind === CompletionCandidateKind.Class)).toBe(true);
  });

  it("routes an extends position to the class-name sources", async () => {
    const src = "model Derived\n  extends Base;\nend Derived;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Base"] })),
    });

    await computeCompletions(
      parse(src),
      offsetOf(src, "Base") + 1,
      "Pkg.Derived",
      client,
    );

    expect(client.getClassNames).toHaveBeenCalledWith({
      typeName: "Pkg.Derived",
    });
    expect(client.searchClassNames).toHaveBeenCalledWith({ searchText: "Base" });
    expect(client.getComponents).not.toHaveBeenCalled();
  });

  it("does NOT fire the global searchClassNames below MIN_FUZZY_PREFIX", async () => {
    // A 1-char prefix (< MIN_FUZZY_PREFIX) must not trigger the global fuzzy
    // search; the cheap scoped getClassNames still runs.
    expect(MIN_FUZZY_PREFIX).toBeGreaterThan(1);
    const src = "model Circuit\n  R r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Ground"] })),
    });

    // Cursor on the single-char type `R`.
    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "R r;"),
      "MyPkg.Circuit",
      client,
    );

    expect(client.getClassNames).toHaveBeenCalledWith({
      typeName: "MyPkg.Circuit",
    });
    expect(client.searchClassNames).not.toHaveBeenCalled();
    expect(out.map((c) => c.label)).toEqual(["Ground"]);
  });

  it("fires searchClassNames once the prefix reaches MIN_FUZZY_PREFIX", async () => {
    // A 2-char prefix `Re` (== MIN_FUZZY_PREFIX) crosses the threshold.
    const src = "model Circuit\n  Re r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Re r;"),
      "MyPkg.Circuit",
      client,
    );

    expect(client.searchClassNames).toHaveBeenCalledWith({ searchText: "Re" });
    expect(out.map((c) => c.label)).toContain("Modelica.Electrical.Resistor");
  });

  it("sets filterText/insertText to the simple name for dotted class candidates", async () => {
    // Fully-qualified searchClassNames labels carry dots that break VSCode's
    // word-based prefix filtering; the candidate must filter & insert by its
    // last segment. Bare getClassNames children keep the default (unset).
    const src = "model Circuit\n  Re r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Resistor"] })),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Re r;"),
      "MyPkg.Circuit",
      client,
    );

    const dotted = out.find((c) => c.label === "Modelica.Electrical.Resistor");
    expect(dotted).toBeDefined();
    expect(dotted?.filterText).toBe("Resistor");
    expect(dotted?.insertText).toBe("Resistor");

    // The bare local child keeps default filtering (no override needed).
    const bare = out.find((c) => c.label === "Resistor");
    expect(bare).toBeDefined();
    expect(bare?.filterText).toBeUndefined();
    expect(bare?.insertText).toBeUndefined();
  });
});

describe("computeCompletions — member access after `.`", () => {
  it("resolves the head's type and routes to getComponents of that type", async () => {
    const src = "model M\nequation\n  y = r.v;\nend M;";
    const getComponents = vi.fn(({ typeName }) => {
      if (typeName === "MyPkg.M") {
        return Promise.resolve({
          components: [{ name: "r", className: "Pkg.Resistor" }],
        });
      }
      if (typeName === "Pkg.Resistor") {
        return Promise.resolve({
          components: [
            { name: "v", className: "Modelica.SIunits.Voltage" },
            { name: "i", className: "Modelica.SIunits.Current" },
          ],
        });
      }
      return Promise.resolve({ components: [] });
    });
    const client = makeClient({ getComponents });

    // Cursor on `v` in `r.v` → head is `r`, members of Pkg.Resistor offered.
    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "v;"),
      "MyPkg.M",
      client,
    );

    // Walk: getComponents(owning) to find r's type, then getComponents(r's type).
    expect(getComponents).toHaveBeenCalledWith({ typeName: "MyPkg.M" });
    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.Resistor" });
    // Class-name / parameter sources are NOT touched for a member access.
    expect(client.getParameterNames).not.toHaveBeenCalled();

    const labels = out.map((c) => c.label);
    expect(labels).toEqual(["v", "i"]);
    expect(out[0]).toEqual({
      label: "v",
      kind: CompletionCandidateKind.Field,
      detail: "Modelica.SIunits.Voltage",
    });
  });

  it("offers package children when the head is a package, via isPackage + getClassNames", async () => {
    // `Modelica.Electrical.|` — bare-dot trigger after a dotted package name in
    // an expression context (a clean trailing-dot parse, no next token grabbed).
    const src = "model M\nequation\n  y = Modelica.Electrical.;\nend M;";
    const dotAfter =
      offsetOf(src, "Modelica.Electrical.") + "Modelica.Electrical.".length;
    const calls: string[] = [];
    const client = makeClient({
      // The head is a package, so the component-type walk fails (no such
      // component), and the package branch takes over.
      getComponents: vi.fn(() => Promise.resolve({ components: [] })),
      qualifyPath: vi.fn(({ path }) =>
        Promise.resolve({ qualifiedPath: path }),
      ),
      isPackage: vi.fn(({ typeName }) => {
        calls.push(`isPackage:${typeName}`);
        return Promise.resolve({ b: true });
      }),
      getClassNames: vi.fn(({ typeName }) => {
        calls.push(`getClassNames:${typeName}`);
        return Promise.resolve({ classNames: ["Resistor", "Capacitor"] });
      }),
    });

    const out = await computeCompletions(
      parse(src),
      dotAfter,
      "MyPkg.M",
      client,
    );

    // Qualified to the package, probed, then its children listed.
    expect(client.qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.M",
      path: "Modelica.Electrical",
    });
    expect(calls).toContain("isPackage:Modelica.Electrical");
    expect(calls).toContain("getClassNames:Modelica.Electrical");
    expect(out.map((c) => c.label)).toEqual(["Resistor", "Capacitor"]);
  });

  it("offers nothing when the head type cannot be resolved", async () => {
    const src = "model M\nequation\n  y = r.v;\nend M;";
    const client = makeClient({
      // No component `r` in the owning class, not a package either.
      getComponents: vi.fn(() => Promise.resolve({ components: [] })),
      isPackage: vi.fn(() => Promise.resolve({ b: false })),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "v;"),
      "MyPkg.M",
      client,
    );
    expect(out).toEqual([]);
  });
});

describe("computeCompletions — bare-dot trigger (empty prefix)", () => {
  it("recovers the head and lists members when `.` was just typed", async () => {
    // `r.` with nothing after the dot — the classifier returns null; the
    // bare-dot recovery walks the head `r` to its type and offers its members.
    const src = "model M\nequation\n  y = r.;\nend M;";
    const dotAfter = offsetOf(src, "r.") + "r.".length;
    const getComponents = vi.fn(({ typeName }) => {
      if (typeName === "MyPkg.M") {
        return Promise.resolve({
          components: [{ name: "r", className: "Pkg.Resistor" }],
        });
      }
      if (typeName === "Pkg.Resistor") {
        return Promise.resolve({
          components: [{ name: "v", className: "SI.Voltage" }],
        });
      }
      return Promise.resolve({ components: [] });
    });
    const client = makeClient({ getComponents });

    const out = await computeCompletions(
      parse(src),
      dotAfter,
      "MyPkg.M",
      client,
    );

    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.Resistor" });
    expect(out.map((c) => c.label)).toEqual(["v"]);
  });
});

describe("computeCompletions — modifier name", () => {
  it("routes to getParameterNames of the modified declaration's type", async () => {
    // `Resistor r(R = 1)` — cursor on the modifier `R`. The declared type
    // `Resistor` is read from the component clause, qualified, then its
    // parameters listed.
    const src = "model M\n  Resistor r(R = 1);\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Resistor" }),
    );
    const getParameterNames = vi.fn(() =>
      Promise.resolve({ parameters: ["R", "T_ref", "alpha"] }),
    );
    const client = makeClient({ qualifyPath, getParameterNames });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "R = 1"),
      "MyPkg.M",
      client,
    );

    // The declared type `Resistor` is qualified in the owning class's scope...
    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.M",
      path: "Resistor",
    });
    // ...then its parameters are listed against the qualified type.
    expect(getParameterNames).toHaveBeenCalledWith({ typeName: "Pkg.Resistor" });
    // Class-name / member sources are NOT touched for a modifier name.
    expect(client.getClassNames).not.toHaveBeenCalled();
    expect(client.searchClassNames).not.toHaveBeenCalled();
    expect(client.getComponents).not.toHaveBeenCalled();

    expect(out.map((c) => c.label)).toEqual(["R", "T_ref", "alpha"]);
    expect(out.every((c) => c.kind === CompletionCandidateKind.Property)).toBe(true);
  });

  it("reads the modified type from an extends clause", async () => {
    const src = "model M\n  extends Base(p = 1);\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Base" }),
    );
    const getParameterNames = vi.fn(() =>
      Promise.resolve({ parameters: ["p", "q"] }),
    );
    const client = makeClient({ qualifyPath, getParameterNames });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "p = 1"),
      "MyPkg.M",
      client,
    );

    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.M",
      path: "Base",
    });
    expect(getParameterNames).toHaveBeenCalledWith({ typeName: "Pkg.Base" });
    expect(out.map((c) => c.label)).toEqual(["p", "q"]);
  });
});

describe("computeCompletions — unknown / non-completable context", () => {
  it("offers nothing on a plain value reference and touches no source", async () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const client = makeClient();

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "x;"),
      "MyPkg.M",
      client,
    );

    expect(out).toEqual([]);
    expect(client.getClassNames).not.toHaveBeenCalled();
    expect(client.searchClassNames).not.toHaveBeenCalled();
    expect(client.getComponents).not.toHaveBeenCalled();
    expect(client.getParameterNames).not.toHaveBeenCalled();
  });

  it("offers nothing when the cursor is on a keyword", async () => {
    const src = "model M\n  Resistor r;\nend M;";
    const client = makeClient();
    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "model"),
      "MyPkg.M",
      client,
    );
    expect(out).toEqual([]);
  });
});

describe("computeCompletions — robustness", () => {
  it("de-dupes by label (local children win over fuzzy hits)", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Resistor"] })),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Resistor"] }),
      ),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    expect(out.filter((c) => c.label === "Resistor")).toHaveLength(1);
  });

  it("caps the result list at MAX_COMPLETIONS", async () => {
    const many = Array.from({ length: MAX_COMPLETIONS + 50 }, (_, i) => `C${i}`);
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: many })),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    expect(out).toHaveLength(MAX_COMPLETIONS);
  });

  it("degrades gracefully when a class-name source throws", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.reject(new Error("boom"))),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    // The failing source is swallowed; the other still contributes.
    expect(out.map((c) => c.label)).toEqual(["Modelica.Electrical.Resistor"]);
  });
});
