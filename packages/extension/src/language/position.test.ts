/**
 * Pin the offset/column contract: `web-tree-sitter` v0.25.x's JavaScript
 * string-input path reports and consumes UTF-16 code units (not UTF-8 bytes,
 * despite the `.d.ts` wording), and `advancePointUtf16` must count units (not
 * code points) so surrogate pairs land at column +2, not +1.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";

import { GRAMMAR_WASM_FILENAME } from "./parse.js";
import {
  advancePointUtf16,
  omcRangeToVscodeRange,
  omcToVscodePosition,
} from "./position.js";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = join(here, "..", "..", "grammar", GRAMMAR_WASM_FILENAME);

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function parse(src: string, oldTree?: Tree): Tree {
  const tree = parser.parse(src, oldTree ?? null);
  if (!tree) throw new Error("parser returned no tree");
  return tree;
}

function findIdent(tree: Tree, text: string) {
  const stack = [tree.rootNode];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "IDENT" && n.text === text) return n;
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!);
  }
  return null;
}

describe("web-tree-sitter string path uses UTF-16 code units (not bytes)", () => {
  it("Node.startIndex is the UTF-16 offset after a multi-byte comment", () => {
    const src = "model M\n  // café — π\n  Resistor r;\nend M;";
    const tree = parse(src);
    const node = findIdent(tree, "Resistor")!;
    const utf16Offset = src.indexOf("Resistor");
    const byteOffset = new TextEncoder().encode(src.slice(0, utf16Offset)).length;
    expect(byteOffset).toBeGreaterThan(utf16Offset);
    expect(node.startIndex).toBe(utf16Offset);
    expect(node.startIndex).not.toBe(byteOffset);
  });

  it("Point.column is the UTF-16 column after an astral character", () => {
    const src = "model M\n  Real \u{1F600}x;\nend M;";
    const tree = parse(src);
    const node = findIdent(tree, "x")!;
    const line = "  Real \u{1F600}x;";
    expect(node.startPosition.row).toBe(1);
    // Surrogate pair counts as 2 units; a code-point count would be 1 short.
    expect(node.startPosition.column).toBe(line.indexOf("x"));
    expect([...line.slice(0, line.indexOf("x"))].length).toBe(
      node.startPosition.column - 1,
    );
  });

  it("a UTF-16-based edit + reparse stays in sync with a fresh parse", () => {
    const before = "model M\n  // café — π\n  Real q = p;\nend M;";
    const at = before.indexOf("p;");
    const after = before.slice(0, at) + "pp" + before.slice(at + 1);

    const oldTree = parse(before);
    oldTree.edit({
      startIndex: at,
      oldEndIndex: at + 1,
      newEndIndex: at + 2,
      startPosition: { row: 2, column: at - before.lastIndexOf("\n", at - 1) - 1 },
      oldEndPosition: { row: 2, column: at - before.lastIndexOf("\n", at - 1) },
      newEndPosition: { row: 2, column: at - before.lastIndexOf("\n", at - 1) + 1 },
    });
    const incremental = parse(after, oldTree);

    expect(incremental.rootNode.hasError).toBe(false);
    const node = findIdent(incremental, "pp");
    expect(node).not.toBeNull();
    expect(node!.startIndex).toBe(after.indexOf("pp"));
  });
});

describe("advancePointUtf16", () => {
  it("grows the column by UTF-16 code units on the same line", () => {
    expect(advancePointUtf16({ row: 1, column: 2 }, "abc")).toEqual({
      row: 1,
      column: 5,
    });
    // A BMP non-ASCII char is 1 UTF-16 unit.
    expect(advancePointUtf16({ row: 0, column: 0 }, "é—π")).toEqual({
      row: 0,
      column: 3,
    });
  });

  it("counts an astral character as 2 UTF-16 units", () => {
    expect(advancePointUtf16({ row: 0, column: 0 }, "\u{1F600}")).toEqual({
      row: 0,
      column: 2,
    });
    expect(advancePointUtf16({ row: 0, column: 3 }, "a\u{1F600}b")).toEqual({
      row: 0,
      column: 3 + 4, // a(1) + 😀(2) + b(1)
    });
  });

  it("resets the column to the trailing line on a newline", () => {
    expect(advancePointUtf16({ row: 0, column: 5 }, "x\nyz")).toEqual({
      row: 1,
      column: 2,
    });
    expect(advancePointUtf16({ row: 2, column: 9 }, "a\nb\u{1F600}")).toEqual({
      row: 3,
      column: 3, // b(1) + 😀(2)
    });
  });
});

describe("omcToVscodePosition", () => {
  it("decrements both line and column by one", () => {
    expect(omcToVscodePosition(1, 1)).toEqual({ line: 0, character: 0 });
    expect(omcToVscodePosition(42, 7)).toEqual({ line: 41, character: 6 });
  });

  it("converts line and column independently", () => {
    expect(omcToVscodePosition(1, 18)).toEqual({ line: 0, character: 17 });
    expect(omcToVscodePosition(10, 1)).toEqual({ line: 9, character: 0 });
  });

  it("clamps a zero OMC coordinate to 0", () => {
    expect(omcToVscodePosition(0, 0)).toEqual({ line: 0, character: 0 });
    expect(omcToVscodePosition(0, 5)).toEqual({ line: 0, character: 4 });
  });
});

describe("omcRangeToVscodeRange", () => {
  it("converts start straight through and makes the end exclusive (+1)", () => {
    const range = omcRangeToVscodeRange({
      lineNumberStart: 1,
      columnNumberStart: 1,
      lineNumberEnd: 1,
      columnNumberEnd: 7,
    });
    expect(range.start).toEqual({ line: 0, character: 0 });
    expect(range.end).toEqual({ line: 0, character: 7 });
  });

  it("spans multiple lines, keeping each coordinate independent", () => {
    const range = omcRangeToVscodeRange({
      lineNumberStart: 3,
      columnNumberStart: 5,
      lineNumberEnd: 9,
      columnNumberEnd: 1,
    });
    expect(range.start).toEqual({ line: 2, character: 4 });
    expect(range.end).toEqual({ line: 8, character: 1 });
  });

  it("collapses to zero-length when synthetic end (columnNumberEnd === 0) lands before start", () => {
    const range = omcRangeToVscodeRange({
      lineNumberStart: 10,
      columnNumberStart: 4,
      lineNumberEnd: 10,
      columnNumberEnd: 0,
    });
    expect(range.start).toEqual({ line: 9, character: 3 });
    expect(range.end).toEqual(range.start);
  });

  it("collapses to zero-length when end line lands before start line", () => {
    const range = omcRangeToVscodeRange({
      lineNumberStart: 10,
      columnNumberStart: 4,
      lineNumberEnd: 5,
      columnNumberEnd: 7,
    });
    expect(range.end).toEqual(range.start);
  });
});
