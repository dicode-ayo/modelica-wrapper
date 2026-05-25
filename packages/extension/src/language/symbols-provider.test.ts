/**
 * Unit tests for the pure document-symbols walk (`computeDocumentSymbols`),
 * run against REAL fixture trees produced by the vendored tree-sitter-modelica
 * grammar WASM (mirrors `cursor.test.ts` / `definition-provider.test.ts`).
 *
 * No `vscode`, no OMC: the walk is pure (tree → plain `SymbolNode[]`), so the
 * tests parse Modelica source strings directly and assert names, kinds,
 * nesting, and selection ranges. The `vscode.DocumentSymbolProvider` wrapper is
 * a thin shell over this core, so covering the core covers the outline logic.
 * If the grammar WASM is missing/incompatible the `beforeAll` rejects and the
 * suite fails loudly (rather than skipping silently).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";

import { GRAMMAR_WASM_FILENAME } from "./parse.js";
import {
  classKind,
  computeDocumentSymbols,
  SymbolKind,
  type SymbolNode,
} from "./symbols-provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = join(here, "..", "..", "grammar", GRAMMAR_WASM_FILENAME);

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

/** Parse `src`; throws if the grammar is unavailable (kept strict on purpose). */
function parse(src: string): Tree {
  const tree = parser.parse(src);
  if (!tree) throw new Error("parser returned no tree");
  return tree;
}

/** First symbol with `name` anywhere in the hierarchy, depth-first. */
function find(symbols: SymbolNode[], name: string): SymbolNode | undefined {
  for (const symbol of symbols) {
    if (symbol.name === name) return symbol;
    const nested = find(symbol.children, name);
    if (nested) return nested;
  }
  return undefined;
}

/** Names of a symbol list, in order (for nesting/order assertions). */
function names(symbols: SymbolNode[]): string[] {
  return symbols.map((s) => s.name);
}

describe("computeDocumentSymbols — class kinds + nesting", () => {
  // A package containing a model with parameters + components + a nested class.
  const src = `package Lib "library doc"
  model M "model doc"
    parameter Real R = 1 "resistance";
    constant Integer N = 3;
    Real x;
    Resistor a, b;
    record Inner "inner doc"
      Real y;
    end Inner;
  end M;
  function f
    input Real u;
    output Real v;
  end f;
  connector C
    Real w;
  end C;
  type Volt = Real;
end Lib;`;

  it("surfaces the top-level package with its doc comment as detail", () => {
    const symbols = computeDocumentSymbols(parse(src));
    expect(names(symbols)).toEqual(["Lib"]);
    const lib = symbols[0]!;
    expect(lib.kind).toBe(SymbolKind.Package);
    expect(lib.detail).toBe("library doc");
  });

  it("nests a package's classes as its children, in source order", () => {
    const symbols = computeDocumentSymbols(parse(src));
    const lib = symbols[0]!;
    expect(names(lib.children)).toEqual(["M", "f", "C", "Volt"]);
  });

  it("maps each restriction to a sensible SymbolKind", () => {
    const symbols = computeDocumentSymbols(parse(src));
    expect(find(symbols, "M")?.kind).toBe(SymbolKind.Class);
    expect(find(symbols, "f")?.kind).toBe(SymbolKind.Function);
    expect(find(symbols, "C")?.kind).toBe(SymbolKind.Interface);
    expect(find(symbols, "Volt")?.kind).toBe(SymbolKind.Enum);
    expect(find(symbols, "Inner")?.kind).toBe(SymbolKind.Struct);
  });

  it("carries a class's doc comment as detail", () => {
    const symbols = computeDocumentSymbols(parse(src));
    expect(find(symbols, "M")?.detail).toBe("model doc");
    expect(find(symbols, "Inner")?.detail).toBe("inner doc");
  });

  it("nests members (components + nested class) inside their class", () => {
    const symbols = computeDocumentSymbols(parse(src));
    const model = find(symbols, "M")!;
    // R, N, x, a, b (one symbol per declared name) + the nested record Inner.
    expect(names(model.children)).toEqual(["R", "N", "x", "a", "b", "Inner"]);
  });

  it("nests a component inside the deepest enclosing class only", () => {
    const symbols = computeDocumentSymbols(parse(src));
    const inner = find(symbols, "Inner")!;
    expect(names(inner.children)).toEqual(["y"]);
  });
});

describe("computeDocumentSymbols — component kinds", () => {
  const src = `model M
  parameter Real R = 1;
  constant Integer N = 3;
  Real x;
end M;`;

  it("classifies a parameter as Property, a constant as Constant, else Field", () => {
    const symbols = computeDocumentSymbols(parse(src));
    expect(find(symbols, "R")?.kind).toBe(SymbolKind.Property);
    expect(find(symbols, "N")?.kind).toBe(SymbolKind.Constant);
    expect(find(symbols, "x")?.kind).toBe(SymbolKind.Field);
  });

  it("emits one symbol per name in a multi-name declaration", () => {
    const symbols = computeDocumentSymbols(parse("model M\n  Real a, b, c;\nend M;"));
    const model = find(symbols, "M")!;
    expect(names(model.children)).toEqual(["a", "b", "c"]);
  });
});

describe("computeDocumentSymbols — ranges", () => {
  it("uses the identifier for selectionRange and the whole decl for range", () => {
    const src = "model Circuit\n  Real x;\nend Circuit;";
    const symbols = computeDocumentSymbols(parse(src));
    const circuit = symbols[0]!;
    // `Circuit` identifier sits on line 0, columns 6..13.
    expect(circuit.selectionRange).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 13 },
    });
    // The declaration range spans from `model` (line 0) through `end Circuit;`.
    expect(circuit.range.start).toEqual({ line: 0, character: 0 });
    expect(circuit.range.end.line).toBe(2);

    const x = find(symbols, "x")!;
    // `x` identifier on line 1 at column 7 (after `  Real `).
    expect(x.selectionRange).toEqual({
      start: { line: 1, character: 7 },
      end: { line: 1, character: 8 },
    });
  });
});

describe("computeDocumentSymbols — extends + prefixes", () => {
  it("skips extends clauses (not outline symbols)", () => {
    const src = `model Derived
  extends Base;
  Real x;
end Derived;`;
    const symbols = computeDocumentSymbols(parse(src));
    const derived = find(symbols, "Derived")!;
    // Only the declared component, not the extended Base.
    expect(names(derived.children)).toEqual(["x"]);
  });

  it("strips class-prefix modifiers when choosing the kind", () => {
    expect(classKind("partial block")).toBe(SymbolKind.Class);
    expect(classKind("operator record")).toBe(SymbolKind.Struct);
    expect(classKind("expandable connector")).toBe(SymbolKind.Interface);
    expect(classKind("package")).toBe(SymbolKind.Package);
    expect(classKind("function")).toBe(SymbolKind.Function);
    expect(classKind("type")).toBe(SymbolKind.Enum);
    expect(classKind("model")).toBe(SymbolKind.Class);
    expect(classKind("")).toBe(SymbolKind.Class);
  });
});

describe("computeDocumentSymbols — robustness", () => {
  it("returns [] for an empty buffer", () => {
    expect(computeDocumentSymbols(parse(""))).toEqual([]);
  });

  it("does not throw on a malformed buffer", () => {
    // Unterminated declaration — tree-sitter returns a tree with error nodes;
    // the whole class collapses into an ERROR node (no recoverable
    // class_definition), so the walk yields nothing rather than throwing.
    const src = "model Broken\n  parameter Real R = ";
    let symbols: SymbolNode[] = [];
    expect(() => {
      symbols = computeDocumentSymbols(parse(src));
    }).not.toThrow();
    expect(symbols).toEqual([]);
  });

  it("recovers a well-formed nested class inside a malformed outer one", () => {
    // The outer package is missing its `end P;`, so it parses as an ERROR node
    // — but the inner `model M` is a clean class_definition. The generic
    // descent still surfaces it.
    const src = "package P\n  model M\n  end M;";
    const symbols = computeDocumentSymbols(parse(src));
    expect(find(symbols, "M")?.kind).toBe(SymbolKind.Class);
  });
});
