/**
 * Unit tests for the pure hover core (`computeHover`) + markdown renderer
 * (`renderHover`).
 *
 * No `vscode`, no live OMC: real fixture trees from the vendored grammar WASM
 * drive the cursor classifier, and the OMC surface is a plain mock. The
 * `vscode.HoverProvider` wrapper is a thin shell over `computeHover`, so testing
 * the core covers the resolution + metadata rendering.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  computeHover,
  escapeMarkdown,
  renderHover,
  type HoverClient,
} from "./hover-provider.js";
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

/** A HoverClient with overridable behavior (resolution + metadata wrappers). */
function makeClient(overrides: Partial<HoverClient> = {}): HoverClient {
  return {
    qualifyPath: vi.fn(({ path }) => Promise.resolve({ qualifiedPath: path })),
    getClassInformation: vi.fn(() =>
      Promise.resolve({
        fileName: "/lib/X.mo",
        restriction: "model",
        comment: "",
      }),
    ),
    getClassComment: vi.fn(() => Promise.resolve({ comment: "" })),
    getComponents: vi.fn(() => Promise.resolve({ components: [] })),
    ...overrides,
  };
}

describe("renderHover", () => {
  it("renders restriction + qualified name as a fenced modelica signature", () => {
    expect(renderHover("Modelica.Electrical.Resistor", "model", "")).toBe(
      "```modelica\nmodel Modelica.Electrical.Resistor\n```",
    );
  });

  it("appends the documentation comment below the signature", () => {
    expect(renderHover("Pkg.Foo", "block", "Ideal linear electrical resistor")).toBe(
      "```modelica\nblock Pkg.Foo\n```\n\nIdeal linear electrical resistor",
    );
  });

  it("omits the restriction prefix when none is reported", () => {
    expect(renderHover("Pkg.Foo", "", "")).toBe("```modelica\nPkg.Foo\n```");
  });

  it("escapes markdown specials in the comment so they aren't re-interpreted", () => {
    // A Modelica description with markdown specials: emphasis underscores, a
    // stray backtick, and an HTML-ish angle bracket. None should survive as
    // *live* markdown — every special must be backslash-escaped or encoded.
    const comment = "uses _x_ as `gain <p>";
    const md = renderHover("Pkg.Foo", "model", comment);
    const body = md.split("```\n\n")[1];

    // Each special is neutralized: underscores and backtick are backslash-
    // escaped, `<` and `>` are HTML-encoded — none appears unescaped.
    expect(body).not.toMatch(/(?<!\\)_/);
    expect(body).not.toMatch(/(?<!\\)`/);
    expect(body).not.toContain("<");
    expect(body).not.toContain(">");

    // The literal text is preserved (escaped/encoded), not dropped.
    expect(body).toBe("uses \\_x\\_ as \\`gain &lt;p&gt;");
  });
});

describe("escapeMarkdown", () => {
  it("backslash-escapes CommonMark punctuation and encodes HTML-ish characters", () => {
    expect(escapeMarkdown("a_b*c`d")).toBe("a\\_b\\*c\\`d");
    expect(escapeMarkdown("x < y > z")).toBe("x &lt; y &gt; z");
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\]\\(url\\)");
    // & must be encoded before the bare-escape pass so already-encoded
    // entities in upstream doc strings (e.g. `&lt;`) don't double-encode.
    expect(escapeMarkdown("a & b")).toBe("a &amp; b");
    expect(escapeMarkdown("&lt;tag>")).toBe("&amp;lt;tag&gt;");
  });

  it("leaves plain prose untouched", () => {
    expect(escapeMarkdown("Ideal linear electrical resistor")).toBe(
      "Ideal linear electrical resistor",
    );
  });
});

describe("computeHover", () => {
  it("renders restriction + doc comment for a resolved class", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const getClassInformation = vi.fn(() =>
      Promise.resolve({
        fileName: "/msl/Resistor.mo",
        restriction: "model",
        comment: "info-only comment",
      }),
    );
    const getClassComment = vi.fn(() =>
      Promise.resolve({ comment: "Ideal linear electrical resistor" }),
    );
    const client = makeClient({
      qualifyPath: vi.fn(() =>
        Promise.resolve({ qualifiedPath: "Modelica.Electrical.Resistor" }),
      ),
      getClassInformation,
      getClassComment,
    });

    const result = await computeHover(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );

    expect(getClassInformation).toHaveBeenCalledWith({
      typeName: "Modelica.Electrical.Resistor",
    });
    expect(getClassComment).toHaveBeenCalledWith({
      typeName: "Modelica.Electrical.Resistor",
    });
    expect(result?.markdown).toBe(
      "```modelica\nmodel Modelica.Electrical.Resistor\n```\n\nIdeal linear electrical resistor",
    );
    // The span is the identifier under the cursor, so the wrapper underlines it
    // without re-walking the tree.
    expect(result?.startIndex).toBe(offsetOf(src, "Resistor"));
    expect(result?.endIndex).toBe(offsetOf(src, "Resistor") + "Resistor".length);
  });

  it("falls back to getClassInformation's comment when getClassComment is empty", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Pkg.Resistor" })),
      getClassInformation: vi.fn(() =>
        Promise.resolve({
          fileName: "/x.mo",
          restriction: "model",
          comment: "bundled comment",
        }),
      ),
      getClassComment: vi.fn(() => Promise.resolve({ comment: "" })),
    });

    const result = await computeHover(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );
    expect(result?.markdown).toBe(
      "```modelica\nmodel Pkg.Resistor\n```\n\nbundled comment",
    );
  });

  it("returns undefined when the cursor resolves to nothing", async () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const client = makeClient();
    const result = await computeHover(
      parse(src),
      offsetOf(src, "x;"),
      "Pkg.M",
      client,
    );
    expect(result).toBeUndefined();
    expect(client.getClassComment).not.toHaveBeenCalled();
  });

  it("returns undefined when the metadata round-trip fails", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Pkg.Resistor" })),
      getClassComment: vi.fn(() => Promise.reject(new Error("offline"))),
    });
    const result = await computeHover(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined (does not throw) when qualifyPath throws", async () => {
    const src = "model Circuit\n  Resistor r;\nend Circuit;";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.reject(new Error("omc qualify failed"))),
    });
    const md = await computeHover(
      parse(src),
      offsetOf(src, "Resistor") + 1,
      "MyPkg.Circuit",
      client,
    );
    expect(md).toBeUndefined();
  });
});

describe("computeHover — malformed / empty buffers", () => {
  it("returns undefined for an empty buffer (no throw)", async () => {
    const client = makeClient();
    await expect(
      computeHover(parse(""), 0, "Pkg.M", client),
    ).resolves.toBeUndefined();
  });

  it("does not throw on a malformed, partially-typed buffer", async () => {
    const src = "model M\n  Resis";
    const client = makeClient({
      qualifyPath: vi.fn(() => Promise.reject(new Error("unloadable"))),
    });
    const md = await computeHover(
      parse(src),
      offsetOf(src, "Resis") + 1,
      "Pkg.M",
      client,
    );
    expect(md).toBeUndefined();
  });

  it("does not throw when the cursor is past the end of a malformed buffer", async () => {
    const src = "model M\n  Real x(";
    const client = makeClient();
    await expect(
      computeHover(parse(src), src.length, "Pkg.M", client),
    ).resolves.toBeUndefined();
  });
});
