/**
 * Unit tests for the pure annotation-token walk (`computeAnnotationTokens`),
 * run against REAL fixture trees produced by the vendored tree-sitter-modelica
 * grammar WASM (mirrors `symbols-provider.test.ts`).
 *
 * No `vscode`, no OMC: the walk is pure (tree → plain `AnnotationToken[]`), so
 * the tests parse Modelica source strings directly and assert the classified
 * text spans. The `vscode.DocumentSemanticTokensProvider` wrapper is a thin
 * shell over this core, so covering the core covers the highlighting logic.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AnnotationTokenType,
  computeAnnotationTokens,
  type AnnotationToken,
} from "./annotation-tokens.js";
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

/** Parse `src`; throws if the grammar is unavailable (kept strict on purpose). */
function parse(src: string): Tree {
  const tree = parser.parse(src);
  if (!tree) throw new Error("parser returned no tree");
  return tree;
}

/** The exact source substring a token's range covers. */
function textOf(src: string, token: AnnotationToken): string {
  const lines = src.split("\n");
  const { start, end } = token.range;
  if (start.line === end.line) {
    return lines[start.line]?.slice(start.character, end.character) ?? "";
  }
  const first = lines[start.line]?.slice(start.character) ?? "";
  const middle = lines.slice(start.line + 1, end.line);
  const last = lines[end.line]?.slice(0, end.character) ?? "";
  return [first, ...middle, last].join("\n");
}

/** Classify `src` and return `{type, text}` pairs in document order. */
function classify(
  src: string,
): Array<{ type: AnnotationTokenType; text: string }> {
  return computeAnnotationTokens(parse(src)).map((token) => ({
    type: token.type,
    text: textOf(src, token),
  }));
}

/** The texts classified as `type`, in document order. */
function textsOfType(src: string, type: AnnotationTokenType): string[] {
  return classify(src)
    .filter((token) => token.type === type)
    .map((token) => token.text);
}

describe("computeAnnotationTokens", () => {
  it("classifies modification-world record and field names", () => {
    const src = `model M
  annotation(Diagram(coordinateSystem(extent={{-100,-100},{100,100}})));
end M;`;
    expect(textsOfType(src, AnnotationTokenType.Record)).toEqual([
      "Diagram",
      "coordinateSystem",
    ]);
    expect(textsOfType(src, AnnotationTokenType.Field)).toEqual(["extent"]);
  });

  it("classifies expression-world record constructors and their fields", () => {
    const src = `model M
  annotation(Diagram(graphics={Line(points={{0,0},{10,10}}, color={0,0,255})}));
end M;`;
    expect(textsOfType(src, AnnotationTokenType.Record)).toEqual([
      "Diagram",
      "Line",
    ]);
    // `graphics` (modification field) then `points`, `color` (named args).
    expect(textsOfType(src, AnnotationTokenType.Field)).toEqual([
      "graphics",
      "points",
      "color",
    ]);
  });

  it("classifies a graphical-enum reference in value position", () => {
    const src = `model M
  annotation(Icon(graphics={Rectangle(fillPattern=FillPattern.Solid, pattern=LinePattern.Dash)}));
end M;`;
    expect(textsOfType(src, AnnotationTokenType.EnumMember)).toEqual([
      "FillPattern.Solid",
      "LinePattern.Dash",
    ]);
  });

  it("does not classify non-enum dotted references as enum members", () => {
    const src = `model M
  annotation(Diagram(graphics={Bitmap(fileName="modelica://Foo.Bar/x.png")}));
end M;`;
    expect(textsOfType(src, AnnotationTokenType.EnumMember)).toEqual([]);
  });

  it("classifies the Documentation record and its info field", () => {
    const src = `model M
  annotation(Documentation(info="<html><p>hi</p></html>"));
end M;`;
    expect(textsOfType(src, AnnotationTokenType.Record)).toEqual([
      "Documentation",
    ]);
    expect(textsOfType(src, AnnotationTokenType.Field)).toEqual(["info"]);
  });

  it("covers annotations on components, not just the class", () => {
    const src = `model M
  Real x annotation(Dialog(group="Init"));
end M;`;
    expect(textsOfType(src, AnnotationTokenType.Record)).toEqual(["Dialog"]);
    expect(textsOfType(src, AnnotationTokenType.Field)).toEqual(["group"]);
  });

  it("returns no tokens for a buffer with no annotation", () => {
    const src = `model M
  Real x = 1;
end M;`;
    expect(computeAnnotationTokens(parse(src))).toEqual([]);
  });

  it("emits tokens in document order across both worlds", () => {
    const src = `model M
  annotation(Icon(graphics={Line(points={{0,0}}, pattern=LinePattern.Dash)}));
end M;`;
    expect(classify(src)).toEqual([
      { type: AnnotationTokenType.Record, text: "Icon" },
      { type: AnnotationTokenType.Field, text: "graphics" },
      { type: AnnotationTokenType.Record, text: "Line" },
      { type: AnnotationTokenType.Field, text: "points" },
      { type: AnnotationTokenType.Field, text: "pattern" },
      { type: AnnotationTokenType.EnumMember, text: "LinePattern.Dash" },
    ]);
  });

  it("does not throw on a truncated, unclosed annotation", () => {
    const src = `model M
  annotation(Diagram(graphics={Line(points={{0,0`;
    expect(() => computeAnnotationTokens(parse(src))).not.toThrow();
  });
});
