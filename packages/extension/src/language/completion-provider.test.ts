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
  type CompletionCandidate,
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

/**
 * Run the pure core and return only the candidate list. Tests that pin the
 * routing/candidates use this; the `isIncomplete` flag is asserted separately
 * (see the dedicated describe block).
 */
async function candidatesOf(
  tree: Tree,
  offset: number,
  owningClass: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  return (await computeCompletions(tree, offset, owningClass, client))
    .candidates;
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

    const out = await candidatesOf(
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

  it("includes classes visible from an enclosing package", async () => {
    // A sibling class declared in the enclosing package `MyPkg` (not a child of
    // the owning class `MyPkg.Circuit`) is visible in a bare type reference.
    const src = "model Circuit\n  Sibling s;\nend Circuit;";
    const getClassNames = vi.fn(({ typeName }) => {
      if (typeName === "MyPkg.Circuit") {
        return Promise.resolve({ classNames: ["Inner"] });
      }
      if (typeName === "MyPkg") {
        return Promise.resolve({ classNames: ["Circuit", "Sibling"] });
      }
      return Promise.resolve({ classNames: [] });
    });
    const client = makeClient({ getClassNames });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "Sibling") + 1,
      "MyPkg.Circuit",
      client,
    );

    // Both the owning class and its enclosing package are queried.
    expect(getClassNames).toHaveBeenCalledWith({ typeName: "MyPkg.Circuit" });
    expect(getClassNames).toHaveBeenCalledWith({ typeName: "MyPkg" });

    const labels = out.map((c) => c.label);
    expect(labels).toContain("Inner");
    expect(labels).toContain("Sibling");
    for (const name of ["Inner", "Sibling"]) {
      expect(out.find((c) => c.label === name)?.kind).toBe(
        CompletionCandidateKind.Class,
      );
    }
  });

  it("de-dupes a name present in both the owning class and an enclosing scope", async () => {
    // `Helper` is a child of both the owning class and its parent package; the
    // nearer (owning-class) entry wins and the name appears exactly once.
    const src = "model Circuit\n  Helper h;\nend Circuit;";
    const getClassNames = vi.fn(({ typeName }) => {
      if (typeName === "MyPkg.Circuit") {
        return Promise.resolve({ classNames: ["Helper"] });
      }
      if (typeName === "MyPkg") {
        return Promise.resolve({ classNames: ["Helper", "Other"] });
      }
      return Promise.resolve({ classNames: [] });
    });
    const client = makeClient({ getClassNames });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "Helper") + 1,
      "MyPkg.Circuit",
      client,
    );

    expect(out.filter((c) => c.label === "Helper")).toHaveLength(1);
    expect(out.map((c) => c.label)).toContain("Other");
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
    const out = await candidatesOf(
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

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "Re r;"),
      "MyPkg.Circuit",
      client,
    );

    expect(client.searchClassNames).toHaveBeenCalledWith({ searchText: "Re" });
    expect(out.map((c) => c.label)).toContain("Modelica.Electrical.Resistor");
  });

  it("filters a dotted global match by its simple name but inserts the FQN", async () => {
    // Fully-qualified searchClassNames labels carry dots that break VSCode's
    // word-based prefix filtering, so filter by the last segment — but the
    // class is not in scope, so insert the FQN (a bare name would not resolve).
    // Bare getClassNames children keep the default (unset).
    const src = "model Circuit\n  Re r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Resistor"] })),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "Re r;"),
      "MyPkg.Circuit",
      client,
    );

    const dotted = out.find((c) => c.label === "Modelica.Electrical.Resistor");
    expect(dotted).toBeDefined();
    expect(dotted?.filterText).toBe("Resistor");
    expect(dotted?.insertText).toBe("Modelica.Electrical.Resistor");

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
    const out = await candidatesOf(
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
    const out = await candidatesOf(
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

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "Real") + 1,
      "MyPkg.M",
      client,
    );

    expect(out.filter((c) => c.label === "Real")).toHaveLength(1);
  });

  it("merges built-in types but NOT keywords/snippets after `extends`", async () => {
    const src = "model Derived\n  extends Ba\nend Derived;";
    const out = await candidatesOf(
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

    const out = await candidatesOf(
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
    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "x;"),
      "MyPkg.M",
      makeClient(),
    );
    expect(out).toEqual([]);
  });

  it("suppresses every static channel in modifier-name position", async () => {
    const src = "model M\n  Resistor r(R = 1);\nend M;";
    const out = await candidatesOf(
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
    const out = await candidatesOf(
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

    const out = await candidatesOf(
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

    const out = await candidatesOf(parse(src), dotAfter, "MyPkg.M", client);

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

    const out = await candidatesOf(
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

    const out = await candidatesOf(parse(src), dotAfter, "MyPkg.M", client);

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

    const out = await candidatesOf(
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

    const out = await candidatesOf(
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

  it("lists parameters in EMPTY parens, including an inherited one", async () => {
    // `Resistor r(|)` — no modifier name typed yet. The type's own params plus
    // those pulled in through `extends` are offered.
    const src = "model M\n  Resistor r();\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Resistor" }),
    );
    const getParameterNames = vi.fn(({ typeName }) => {
      if (typeName === "Pkg.Resistor") {
        return Promise.resolve({ parameters: ["R", "T_ref"] });
      }
      if (typeName === "Pkg.ConditionalHeatPort") {
        return Promise.resolve({ parameters: ["useHeatPort"] });
      }
      return Promise.resolve({ parameters: [] });
    });
    const getInheritedClasses = vi.fn(({ typeName }) =>
      Promise.resolve({
        inheritedClasses:
          typeName === "Pkg.Resistor" ? ["Pkg.ConditionalHeatPort"] : [],
      }),
    );
    const client = makeClient({
      qualifyPath,
      getParameterNames,
      getInheritedClasses,
    });

    const out = await candidatesOf(
      parse(src),
      // Caret between `(` and `)`.
      offsetOf(src, ")"),
      "MyPkg.M",
      client,
    );

    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.M",
      path: "Resistor",
    });
    const labels = out.map((c) => c.label);
    expect(labels).toContain("R");
    // The inherited parameter is present — `getParameterNames` alone would drop it.
    expect(labels).toContain("useHeatPort");
    expect(out.every((c) => c.kind === CompletionCandidateKind.Property)).toBe(
      true,
    );
    // No class-name / static channel leaks into modifier parens.
    expect(client.getClassNames).not.toHaveBeenCalled();
    expect(client.searchClassNames).not.toHaveBeenCalled();
  });

  it("lists parameters before a component name is typed (`Type(|)`)", async () => {
    // Mid-edit `Modelica.Electrical.Analog.Basic.Resistor(|)` parses as an ERROR
    // region (no component name), yet the modified type still resolves.
    const src =
      "model M\n  Modelica.Electrical.Analog.Basic.Resistor();\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({
        qualifiedPath: "Modelica.Electrical.Analog.Basic.Resistor",
      }),
    );
    const getParameterNames = vi.fn(() =>
      Promise.resolve({ parameters: ["R", "T_ref", "alpha"] }),
    );
    const client = makeClient({ qualifyPath, getParameterNames });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, ")"),
      "MyPkg.M",
      client,
    );

    expect(qualifyPath).toHaveBeenCalledWith({
      typeName: "MyPkg.M",
      path: "Modelica.Electrical.Analog.Basic.Resistor",
    });
    expect(getParameterNames).toHaveBeenCalledWith({
      typeName: "Modelica.Electrical.Analog.Basic.Resistor",
    });
    expect(out.map((c) => c.label)).toEqual(["R", "T_ref", "alpha"]);
    expect(client.getClassNames).not.toHaveBeenCalled();
  });

  it("still completes a partially-typed parameter name (`r(R|)`)", async () => {
    const src = "model M\n  Resistor r(R);\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Resistor" }),
    );
    const getParameterNames = vi.fn(() =>
      Promise.resolve({ parameters: ["R", "T_ref"] }),
    );
    const client = makeClient({ qualifyPath, getParameterNames });

    const out = await candidatesOf(
      parse(src),
      // Caret just after the typed `R`.
      offsetOf(src, "R)") + 1,
      "MyPkg.M",
      client,
    );

    expect(getParameterNames).toHaveBeenCalledWith({
      typeName: "Pkg.Resistor",
    });
    expect(out.map((c) => c.label)).toEqual(["R", "T_ref"]);
    expect(client.getClassNames).not.toHaveBeenCalled();
  });

  it("does not offer parameters on a modifier VALUE reference", async () => {
    // `r(R = x|)` — the caret is on the value `x`, a component reference, not a
    // modifier name. Parameter names must not be offered there.
    const src = "model M\n  Resistor r(R = x);\nend M;";
    const client = makeClient({
      qualifyPath: vi.fn(() =>
        Promise.resolve({ qualifiedPath: "Pkg.Resistor" }),
      ),
      getParameterNames: vi.fn(() =>
        Promise.resolve({ parameters: ["R", "T_ref"] }),
      ),
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "x)") + 1,
      "MyPkg.M",
      client,
    );

    expect(out).toEqual([]);
    expect(client.getParameterNames).not.toHaveBeenCalled();
  });

  it("offers nothing for an unterminated modifier with no closing paren", async () => {
    // `Resistor r(|` at end of buffer — the modification never closes, so the
    // structural detection finds no parens to be inside. Pins this boundary so a
    // future descendantForIndex change can't silently start (mis)resolving here.
    const src = "model M\n  Resistor r(\nend M;";
    const client = makeClient({
      getParameterNames: vi.fn(() =>
        Promise.resolve({ parameters: ["R", "T_ref"] }),
      ),
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "r(") + 2,
      "MyPkg.M",
      client,
    );

    expect(out).toEqual([]);
    expect(client.getParameterNames).not.toHaveBeenCalled();
  });

  it("lists the sub-component's params in a nested modifier (`m(resistor(|))`)", async () => {
    // `Motor m(resistor(|))` — the caret is inside the nested `resistor`
    // modifier, so its type's parameters (incl. inherited) are offered, NOT the
    // outer `Motor`'s.
    const src = "model M\n  Motor m(resistor());\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Motor" }),
    );
    const getComponents = vi.fn(({ typeName }) =>
      Promise.resolve({
        components:
          typeName === "Pkg.Motor"
            ? [{ className: "Pkg.Resistor", name: "resistor" }]
            : [],
      }),
    );
    const getInheritedClasses = vi.fn(({ typeName }) =>
      Promise.resolve({
        inheritedClasses:
          typeName === "Pkg.Resistor" ? ["Pkg.ConditionalHeatPort"] : [],
      }),
    );
    const getParameterNames = vi.fn(({ typeName }) => {
      if (typeName === "Pkg.Resistor") {
        return Promise.resolve({ parameters: ["R", "T_ref"] });
      }
      if (typeName === "Pkg.ConditionalHeatPort") {
        return Promise.resolve({ parameters: ["useHeatPort"] });
      }
      // The outer Motor's params must never be listed here.
      if (typeName === "Pkg.Motor") {
        return Promise.resolve({ parameters: ["J", "phi"] });
      }
      return Promise.resolve({ parameters: [] });
    });
    const client = makeClient({
      qualifyPath,
      getComponents,
      getInheritedClasses,
      getParameterNames,
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "())") + 1,
      "MyPkg.M",
      client,
    );

    // `resistor` resolves to its type in the qualified `Motor`...
    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.Motor" });
    // ...and that type's parameters (incl. the inherited one) are listed.
    const labels = out.map((c) => c.label);
    expect(labels).toContain("R");
    expect(labels).toContain("useHeatPort");
    expect(labels).not.toContain("J");
    expect(getParameterNames).not.toHaveBeenCalledWith({
      typeName: "Pkg.Motor",
    });
    expect(out.every((c) => c.kind === CompletionCandidateKind.Property)).toBe(
      true,
    );
  });

  it("walks two nesting levels (`m(a(b(|)))`)", async () => {
    const src = "model M\n  Outer m(a(b()));\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Outer" }),
    );
    const getComponents = vi.fn(({ typeName }) => {
      if (typeName === "Pkg.Outer") {
        return Promise.resolve({
          components: [{ className: "Pkg.A", name: "a" }],
        });
      }
      if (typeName === "Pkg.A") {
        return Promise.resolve({
          components: [{ className: "Pkg.B", name: "b" }],
        });
      }
      return Promise.resolve({ components: [] });
    });
    const getParameterNames = vi.fn(({ typeName }) =>
      Promise.resolve({
        parameters: typeName === "Pkg.B" ? ["bParam"] : ["wrong"],
      }),
    );
    const client = makeClient({
      qualifyPath,
      getComponents,
      getParameterNames,
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "()))") + 1,
      "MyPkg.M",
      client,
    );

    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.Outer" });
    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.A" });
    expect(getParameterNames).toHaveBeenCalledWith({ typeName: "Pkg.B" });
    expect(out.map((c) => c.label)).toEqual(["bParam"]);
  });

  it("offers nothing when a nested modifier name doesn't resolve", async () => {
    // `Motor m(nope(|))` — `nope` is not a component of `Motor`, so the walk
    // dead-ends and no parameters are offered (degrade, don't throw).
    const src = "model M\n  Motor m(nope());\nend M;";
    const qualifyPath = vi.fn(() =>
      Promise.resolve({ qualifiedPath: "Pkg.Motor" }),
    );
    const getComponents = vi.fn(() => Promise.resolve({ components: [] }));
    const getParameterNames = vi.fn(() =>
      Promise.resolve({ parameters: ["J", "phi"] }),
    );
    const client = makeClient({
      qualifyPath,
      getComponents,
      getParameterNames,
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "())") + 1,
      "MyPkg.M",
      client,
    );

    expect(out).toEqual([]);
    // The outer type's params are not a fallback for an unresolved sub-component.
    expect(getParameterNames).not.toHaveBeenCalledWith({
      typeName: "Pkg.Motor",
    });
  });
});

describe("computeCompletions — unknown / non-completable context", () => {
  it("offers nothing on a plain value reference and touches no source", async () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const client = makeClient();

    const out = await candidatesOf(
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
    const out = await candidatesOf(
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

    const out = await candidatesOf(
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

    const out = await candidatesOf(
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

    const out = await candidatesOf(
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

    const out = await candidatesOf(parse(src), dotAfter, "MyPkg.M", client);
    expect(out).toEqual([]);
  });
});

describe("computeCompletions — textual routing fallback (broken buffers)", () => {
  it("routes `r.` to member completion when the buffer is unparseable", async () => {
    // Neither the AST classifier nor the dot-node recovery yields a head here,
    // so the textual fallback must route `r` to its members.
    const src = "model M\n  Resistor r\n  r.";
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

    const out = await candidatesOf(parse(src), src.length, "MyPkg.M", client);

    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.Resistor" });
    expect(out.map((c) => c.label)).toEqual(["v"]);
  });

  it("routes a bare prefix to class-name completion when the buffer is unparseable", async () => {
    const src = "model M\n  Resistor r\n  Res";
    const client = makeClient({
      getClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Resistor", "Ground"] }),
      ),
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const out = await candidatesOf(parse(src), src.length, "MyPkg.M", client);

    expect(client.getClassNames).toHaveBeenCalledWith({
      typeName: "MyPkg.M",
    });
    expect(client.searchClassNames).toHaveBeenCalledWith({ searchText: "Res" });
    const labels = out.map((c) => c.label);
    expect(labels).toContain("Resistor");
    expect(labels).toContain("Modelica.Electrical.Resistor");
    // A broken parse carries no statement-position signal, so the keyword and
    // snippet channels stay out of the textual fallback.
    expect(out.some((c) => c.kind === CompletionCandidateKind.Keyword)).toBe(
      false,
    );
    expect(out.some((c) => c.kind === CompletionCandidateKind.Snippet)).toBe(
      false,
    );
    // Built-in types still merge in (a broken type prefix may still be one).
    expect(labels).toContain("Real");
  });

  it("routes a dotted head textually for `a.b.` in a broken buffer", async () => {
    const src = "model M\n  A a\n  a.b.";
    const getComponents = vi.fn(({ typeName }) => {
      switch (typeName) {
        case "MyPkg.M":
          return Promise.resolve({
            components: [{ name: "a", className: "Pkg.A" }],
          });
        case "Pkg.A":
          return Promise.resolve({
            components: [{ name: "b", className: "Pkg.B" }],
          });
        case "Pkg.B":
          return Promise.resolve({
            components: [{ name: "c", className: "SI.Voltage" }],
          });
        default:
          return Promise.resolve({ components: [] });
      }
    });
    const client = makeClient({ getComponents });

    const out = await candidatesOf(parse(src), src.length, "MyPkg.M", client);

    expect(getComponents).toHaveBeenCalledWith({ typeName: "Pkg.B" });
    expect(out.map((c) => c.label)).toEqual(["c"]);
  });

  it("stays silent when the broken buffer has no word before the caret", async () => {
    const src = "model M\n  Resistor r\n  ";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Ground"] })),
    });

    const out = await candidatesOf(parse(src), src.length, "MyPkg.M", client);
    expect(out).toEqual([]);
  });

  it("does not regress the AST path: a well-formed type position never falls through to text", async () => {
    // With a clean parse the AST classifier owns routing; the textual fallback
    // must not run. searchClassNames carrying the exact typed prefix proves the
    // AST `target.identifier` drove it, not a textual re-derivation.
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      searchClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
    });

    await computeCompletions(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    expect(client.searchClassNames).toHaveBeenCalledWith({
      searchText: "Resistor",
    });
  });
});

describe("computeCompletions — malformed / empty buffers", () => {
  it("returns [] for an empty buffer (no throw)", async () => {
    const client = makeClient();
    await expect(candidatesOf(parse(""), 0, "Pkg.M", client)).resolves.toEqual(
      [],
    );
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
      candidatesOf(parse(src), offsetOf(src, "Resis") + 1, "Pkg.M", client),
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
      candidatesOf(parse(src), src.length, "Pkg.M", client),
    ).resolves.toBeInstanceOf(Array);
  });
});

describe("computeCompletions — isIncomplete per context", () => {
  it("marks a fuzzy-global type position incomplete so VSCode re-queries", async () => {
    // A prefix at MIN_FUZZY_PREFIX fires searchClassNames; that global net
    // widens as the prefix grows, so the result must be incomplete.
    const src = "model Circuit\n  Re r;\nend Circuit;";
    const client = makeClient({
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const result = await computeCompletions(
      parse(src),
      offsetOf(src, "Re r;"),
      "MyPkg.Circuit",
      client,
    );

    expect(client.searchClassNames).toHaveBeenCalledWith({ searchText: "Re" });
    expect(result.isIncomplete).toBe(true);
  });

  it("marks a sub-threshold type position complete (no fuzzy net fired)", async () => {
    // A 1-char prefix stays below MIN_FUZZY_PREFIX, so only the stable scoped
    // children are offered — VSCode can filter them locally.
    const src = "model Circuit\n  R r;\nend Circuit;";
    const client = makeClient({
      getClassNames: vi.fn(() => Promise.resolve({ classNames: ["Ground"] })),
    });

    const result = await computeCompletions(
      parse(src),
      offsetOf(src, "R r;"),
      "MyPkg.Circuit",
      client,
    );

    expect(client.searchClassNames).not.toHaveBeenCalled();
    expect(result.isIncomplete).toBe(false);
  });

  it("marks member access complete (resolved members are a stable set)", async () => {
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

    const result = await computeCompletions(
      parse(src),
      offsetOf(src, "v;"),
      "MyPkg.M",
      makeClient({ getComponents }),
    );

    expect(result.isIncomplete).toBe(false);
  });

  it("marks modifier-name completion complete (own parameters are stable)", async () => {
    const src = "model M\n  Resistor r(R = 1);\nend M;";
    const result = await computeCompletions(
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

    expect(result.isIncomplete).toBe(false);
  });

  it("marks a non-completable context complete (empty, stable)", async () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const result = await computeCompletions(
      parse(src),
      offsetOf(src, "x;"),
      "MyPkg.M",
      makeClient(),
    );

    expect(result.candidates).toEqual([]);
    expect(result.isIncomplete).toBe(false);
  });

  it("marks the textual fuzzy fallback incomplete in a broken buffer", async () => {
    // The broken-buffer bare-prefix fallback also fires the fuzzy net, so it
    // must re-query as the prefix grows just like the AST type position.
    const src = "model M\n  Resistor r\n  Res";
    const client = makeClient({
      searchClassNames: vi.fn(() =>
        Promise.resolve({ classNames: ["Modelica.Electrical.Resistor"] }),
      ),
    });

    const result = await computeCompletions(
      parse(src),
      src.length,
      "MyPkg.M",
      client,
    );

    expect(client.searchClassNames).toHaveBeenCalledWith({ searchText: "Res" });
    expect(result.isIncomplete).toBe(true);
  });
});

describe("computeCompletions — type-position package navigation", () => {
  it("drills a dotted package prefix in a type slot into its classes", async () => {
    // `Modelica.Electrical.` in element position (NOT an equation), directly
    // before `end M;`: the parser reads the segment before the dot as a type
    // reference AND absorbs the following `end` as a trailing segment. The drill
    // must still target `Modelica.Electrical` (the head up to the cursor's dot),
    // not the member-access context and not the absorbed `end`.
    const src = "model M\n  Modelica.Electrical.\nend M;";
    const dotAfter =
      offsetOf(src, "Modelica.Electrical.") + "Modelica.Electrical.".length;
    const getClassNames = vi.fn(({ typeName }) =>
      Promise.resolve({
        classNames:
          typeName === "Modelica.Electrical" ? ["Resistor", "Capacitor"] : [],
      }),
    );
    const client = makeClient({
      qualifyPath: vi.fn(({ path }) =>
        Promise.resolve({ qualifiedPath: path }),
      ),
      isPackage: vi.fn(() => Promise.resolve({ b: true })),
      getClassNames,
    });

    const out = await candidatesOf(parse(src), dotAfter, "MyPkg.M", client);

    expect(getClassNames).toHaveBeenCalledWith({
      typeName: "Modelica.Electrical",
    });
    expect(out.map((c) => c.label)).toEqual(["Resistor", "Capacitor"]);
    // Drilled classes insert their bare name — the package prefix is already typed.
    expect(out.every((c) => c.insertText === undefined)).toBe(true);
  });

  it("inserts the fully-qualified name for a global fuzzy match", async () => {
    // A bare prefix in type position fuzzy-matches a loaded class that is NOT
    // in scope, so accepting must insert the FQN (a bare name would not resolve).
    const src = "model M\n  Resis\nend M;";
    const client = makeClient({
      searchClassNames: vi.fn(() =>
        Promise.resolve({
          classNames: ["Modelica.Electrical.Analog.Basic.Resistor"],
        }),
      ),
    });

    const out = await candidatesOf(
      parse(src),
      offsetOf(src, "Resis") + "Resis".length,
      "MyPkg.M",
      client,
    );

    const match = out.find(
      (c) => c.label === "Modelica.Electrical.Analog.Basic.Resistor",
    );
    expect(match).toBeDefined();
    expect(match?.insertText).toBe("Modelica.Electrical.Analog.Basic.Resistor");
    expect(match?.filterText).toBe("Resistor");
  });
});
