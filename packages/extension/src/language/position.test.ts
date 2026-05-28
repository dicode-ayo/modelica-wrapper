/**
 * Tests pinning the offset/column contract of the tree-sitter layer.
 *
 * The round-1 review worried that VSCode UTF-16 offsets were being fed into
 * tree-sitter fields that expect UTF-8 *byte* indices. These tests verify the
 * actual contract of `web-tree-sitter` v0.25.x on its **JavaScript string-input
 * path**: it reports and consumes **UTF-16 code units** (matching JS
 * `String.length` and VSCode), NOT UTF-8 bytes. The `.d.ts` "UTF8" wording
 * describes the underlying C API; the JS binding transcodes for you.
 *
 * They also lock in the one genuine fix this layer needed: advancing a column
 * by the inserted text must count UTF-16 code *units* (so astral characters /
 * surrogate pairs count as 2), which a `for…of` code-point loop got wrong.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";

import { GRAMMAR_WASM_FILENAME } from "./parse.js";
import { advancePointUtf16 } from "./position.js";

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
    const utf16Offset = src.indexOf("Resistor"); // UTF-16 units (JS string)
    const byteOffset = new TextEncoder().encode(src.slice(0, utf16Offset)).length;
    expect(byteOffset).toBeGreaterThan(utf16Offset); // they really do diverge
    // If the binding were byte-native, startIndex would equal byteOffset.
    expect(node.startIndex).toBe(utf16Offset);
    expect(node.startIndex).not.toBe(byteOffset);
  });

  it("Point.column is the UTF-16 column after an astral character", () => {
    const src = "model M\n  Real \u{1F600}x;\nend M;"; // 😀 then ident on line 1
    const tree = parse(src);
    const node = findIdent(tree, "x")!;
    const line = "  Real \u{1F600}x;";
    expect(node.startPosition.row).toBe(1);
    // UTF-16 column (surrogate pair = 2 units), not the 8 code points before x.
    expect(node.startPosition.column).toBe(line.indexOf("x"));
    expect([...line.slice(0, line.indexOf("x"))].length).toBe(
      node.startPosition.column - 1,
    );
  });

  it("a UTF-16-based edit + reparse stays in sync with a fresh parse", () => {
    // Rename `p` → `pp` on a line that follows a multi-byte comment. Offsets are
    // taken straight from the JS string (UTF-16) with no byte conversion.
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

  it("counts an astral character as 2 UTF-16 units (the surrogate-pair fix)", () => {
    // A code-point loop would report column 1 here; the UTF-16 unit count is 2.
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
    // Trailing line with an astral char counts UTF-16 units.
    expect(advancePointUtf16({ row: 2, column: 9 }, "a\nb\u{1F600}")).toEqual({
      row: 3,
      column: 3, // b(1) + 😀(2)
    });
  });
});
