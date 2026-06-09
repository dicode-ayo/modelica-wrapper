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
    if (idx === -1)
      throw new Error(`needle not found: ${needle}#${occurrence}`);
    from = idx;
  }
  return idx;
}

/** A CompletionClient with overridable behaviour and call recording. */
function makeClient(
  overrides: Partial<CompletionClient> = {},
): CompletionClient {
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
    getInheritedClasses: vi.fn(() => Promise.resolve({ inheritedClasses: [] })),
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
    // The OMC-sourced names carry the Class kind.
    for (const name of [
      "Ground",
      "Capacitor",
      "Modelica.Electrical.Resistor",
    ]) {
      expect(out.find((c) => c.label === name)?.kind).toBe(
        CompletionCandidateKind.Class,
      );
    }
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
    expect(client.searchClassNames).toHaveBeenCalledWith({
      searchText: "Base",
    });
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
    // The scoped OMC child is offered; the fuzzy global net is withheld.
    expect(out.map((c) => c.label)).toContain("Ground");
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

describe("computeCompletions — static channels", () => {
  const elementSrc = "model M\n  par\nend M;";
  const elementOffset = offsetOf(elementSrc, "par") + 1;

  it("offers keywords, built-in types, and snippets in element position", async () => {
    const out = await computeCompletions(
      parse(elementSrc),
      elementOffset,
      "MyPkg.M",
      makeClient(),
    );

    const byKind = (kind: CompletionCandidateKind) =>
      out.filter((c) => c.kind === kind).map((c) => c.label);

    expect(byKind(CompletionCandidateKind.Keyword)).toEqual(
      expect.arrayContaining(["parameter", "constant", "extends", "model"]),
    );
    expect(byKind(CompletionCandidateKind.Class)).toEqual(
      expect.arrayContaining(["Real", "Integer", "Boolean", "String"]),
    );
    expect(byKind(CompletionCandidateKind.Snippet)).toEqual(
      expect.arrayContaining(["model", "function", "for", "if"]),
    );
  });

  it("wraps snippet candidates with placeholder insertText, not the keyword", async () => {
    const out = await computeCompletions(
      parse(elementSrc),
      elementOffset,
      "MyPkg.M",
      makeClient(),
    );

    const modelSnippet = out.find(
      (c) => c.kind === CompletionCandidateKind.Snippet && c.label === "model",
    );
    expect(modelSnippet?.isSnippet).toBe(true);
    expect(modelSnippet?.insertText).toContain("${1:");
    expect(modelSnippet?.insertText).toContain("end");

    const modelKeyword = out.find(
      (c) => c.kind === CompletionCandidateKind.Keyword && c.label === "model",
    );
    expect(modelKeyword?.isSnippet).toBeUndefined();
    expect(modelKeyword?.insertText).toBeUndefined();
  });

  it("de-dupes a built-in type against a same-named OMC class (single `Real`)", async () => {
    const src = "model M\n  Real\nend M;";
    const client = makeClient({
      searchClassNames: vi.fn(() => Promise.resolve({ classNames: ["Real"] })),
    });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Real") + 1,
      "MyPkg.M",
      client,
    );

    expect(out.filter((c) => c.label === "Real")).toHaveLength(1);
  });

  it("merges built-in types but NOT keywords/snippets after `extends`", async () => {
    const src = "model Derived\n  extends Ba\nend Derived;";
    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "Ba\n") + 1,
      "Pkg.Derived",
      makeClient(),
    );

    const labels = out.map((c) => c.label);
    // Built-in types reach extends position (a base may be a predefined type).
    expect(labels).toEqual(expect.arrayContaining(["Real", "Integer"]));
    // Statement-only channels stay out of a base-class reference.
    expect(out.some((c) => c.kind === CompletionCandidateKind.Keyword)).toBe(
      false,
    );
    expect(out.some((c) => c.kind === CompletionCandidateKind.Snippet)).toBe(
      false,
    );
  });

  it("suppresses every static channel after a `.` (member access)", async () => {
    const src = "model M\nequation\n  y = r.v;\nend M;";
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

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "v;"),
      "MyPkg.M",
      makeClient({ getComponents }),
    );

    expect(out.map((c) => c.label)).toEqual(["v"]);
    expect(
      out.some(
        (c) =>
          c.kind === CompletionCandidateKind.Keyword ||
          c.kind === CompletionCandidateKind.Snippet ||
          c.label === "Real",
      ),
    ).toBe(false);
  });

  it("suppresses every static channel in value/expression position", async () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "x;"),
      "MyPkg.M",
      makeClient(),
    );
    expect(out).toEqual([]);
  });

  it("suppresses every static channel in modifier-name position", async () => {
    const src = "model M\n  Resistor r(R = 1);\nend M;";
    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "R = 1"),
      "MyPkg.M",
      makeClient({
        qualifyPath: vi.fn(() =>
          Promise.resolve({ qualifiedPath: "Pkg.Resistor" }),
        ),
        getParameterNames: vi.fn(() => Promise.resolve({ parameters: ["R"] })),
      }),
    );

    expect(out.map((c) => c.label)).toEqual(["R"]);
    expect(
      out.some(
        (c) =>
          c.kind === CompletionCandidateKind.Keyword ||
          c.kind === CompletionCandidateKind.Snippet ||
          c.kind === CompletionCandidateKind.Class,
      ),
    ).toBe(false);
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

  it("includes members inherited through extends, with own members shadowing", async () => {
    // Resistor declares `R` and extends OnePort, which contributes `v` and a
    // same-named `R` that the own declaration must shadow.
    const src = "model M\nequation\n  y = r.v;\nend M;";
    const getComponents = vi.fn(({ typeName }) => {
      switch (typeName) {
        case "MyPkg.M":
          return Promise.resolve({
            components: [{ name: "r", className: "Pkg.Resistor" }],
          });
        case "Pkg.Resistor":
          return Promise.resolve({
            components: [{ name: "R", className: "Pkg.OwnR" }],
          });
        case "Pkg.OnePort":
          return Promise.resolve({
            components: [
              { name: "v", className: "SI.Voltage" },
              { name: "R", className: "Pkg.BaseR" },
            ],
          });
        default:
          return Promise.resolve({ components: [] });
      }
    });
    const getInheritedClasses = vi.fn(({ typeName }) =>
      typeName === "Pkg.Resistor"
        ? Promise.resolve({ inheritedClasses: ["Pkg.OnePort"] })
        : Promise.resolve({ inheritedClasses: [] }),
    );
    const client = makeClient({ getComponents, getInheritedClasses });

    const out = await computeCompletions(
      parse(src),
      offsetOf(src, "v;"),
      "MyPkg.M",
      client,
    );

    const byLabel = new Map(out.map((c) => [c.label, c]));
    // The inherited member `v` must appear.
    expect(byLabel.get("v")).toEqual({
      label: "v",
      kind: CompletionCandidateKind.Field,
      detail: "SI.Voltage",
    });
    // `R` resolves to the own declaration, not the base's same-named one.
    expect(byLabel.get("R")?.detail).toBe("Pkg.OwnR");
    // De-duped: `R` appears exactly once.
    expect(out.filter((c) => c.label === "R")).toHaveLength(1);
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
    expect(getParameterNames).toHaveBeenCalledWith({
      typeName: "Pkg.Resistor",
    });
    // Class-name / member sources are NOT touched for a modifier name.
    expect(client.getClassNames).not.toHaveBeenCalled();
    expect(client.searchClassNames).not.toHaveBeenCalled();
    expect(client.getComponents).not.toHaveBeenCalled();

    expect(out.map((c) => c.label)).toEqual(["R", "T_ref", "alpha"]);
    expect(out.every((c) => c.kind === CompletionCandidateKind.Property)).toBe(
      true,
    );
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

  it("caps the OMC class-name portion at MAX_COMPLETIONS (static channels exempt)", async () => {
    const many = Array.from(
      { length: MAX_COMPLETIONS + 50 },
      (_, i) => `C${i}`,
    );
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

    // The unbounded OMC names are capped; the fixed static channels are not, so
    // the keyword/snippet set still surfaces alongside the trimmed names.
    const omcNames = out.filter((c) => c.label.startsWith("C"));
    expect(omcNames).toHaveLength(MAX_COMPLETIONS);
    expect(out.some((c) => c.kind === CompletionCandidateKind.Keyword)).toBe(
      true,
    );
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
    expect(out.map((c) => c.label)).toContain("Modelica.Electrical.Resistor");
  });

  it("returns [] (does not throw) when qualifyPath rejects on a member head", async () => {
    const src = "model M\nequation\n  y = Modelica.Electrical.;\nend M;";
    const dotAfter =
      offsetOf(src, "Modelica.Electrical.") + "Modelica.Electrical.".length;
    const client = makeClient({
      // Component walk fails, so the head falls through to qualifyPath — which
      // rejects. The provider must degrade to no candidates, not throw out.
      getComponents: vi.fn(() => Promise.resolve({ components: [] })),
      qualifyPath: vi.fn(() => Promise.reject(new Error("offline"))),
    });

    const out = await computeCompletions(
      parse(src),
      dotAfter,
      "MyPkg.M",
      client,
    );
    expect(out).toEqual([]);
  });
});

describe("computeCompletions — malformed / empty buffers", () => {
  it("returns [] for an empty buffer (no throw)", async () => {
    const client = makeClient();
    await expect(
      computeCompletions(parse(""), 0, "Pkg.M", client),
    ).resolves.toEqual([]);
  });

  it("does not throw on a malformed, partially-typed buffer", async () => {
    // Mid-type with every source throwing: routing must still degrade to [].
    const src = "model M\n  Resis";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.reject(new Error("x"))),
      searchClassNames: vi.fn(() => Promise.reject(new Error("x"))),
      qualifyPath: vi.fn(() => Promise.reject(new Error("x"))),
      getComponents: vi.fn(() => Promise.reject(new Error("x"))),
    });
    await expect(
      computeCompletions(
        parse(src),
        offsetOf(src, "Resis") + 1,
        "Pkg.M",
        client,
      ),
    ).resolves.toBeInstanceOf(Array);
  });

  it("does not throw on a bare-dot trigger in a malformed buffer", async () => {
    // `r.` with nothing after and an unterminated model — the head-before-dot
    // recovery path must tolerate throwing OMC sources.
    const src = "model M\n  R r;\nequation\n  r.";
    const client = makeClient({
      getComponents: vi.fn(() => Promise.reject(new Error("x"))),
      qualifyPath: vi.fn(() => Promise.reject(new Error("x"))),
    });
    await expect(
      computeCompletions(parse(src), src.length, "Pkg.M", client),
    ).resolves.toBeInstanceOf(Array);
  });
});
