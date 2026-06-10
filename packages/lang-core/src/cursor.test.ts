/**
 * Unit tests for the pure cursor classifier, run against REAL fixture trees
 * produced by the vendored tree-sitter-modelica grammar WASM.
 *
 * These do not touch `vscode`; they parse source strings directly with
 * `web-tree-sitter` and assert what `targetAt`/`classify` report at chosen
 * UTF-16 code-unit offsets (tree-sitter's string-input unit; see `position.ts`).
 * If the grammar WASM is ever missing or incompatible the `beforeAll` rejects
 * and the suite fails loudly (rather than skipping silently) — the parse layer
 * is load-bearing for every language feature.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";

import {
  annotationPath,
  annotationValueField,
  classify,
  cursorInErrorRegion,
  identifierAt,
  modifiedTypeWithPath,
  nodeAt,
  targetAt,
  textualWordBefore,
} from "./cursor.js";

// The grammar WASM is an install artifact of the extension package; reach into
// its grammar dir rather than re-fetch it here.
const GRAMMAR_WASM_FILENAME = "tree-sitter-modelica.wasm";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = join(
  here,
  "..",
  "..",
  "extension",
  "grammar",
  GRAMMAR_WASM_FILENAME,
);

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

/** Byte offset of the (occurrence-th) literal `needle` inside `src`. */
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

describe("nodeAt / identifierAt", () => {
  it("finds the IDENT under the cursor", () => {
    const src = "model M\n  Resistor r;\nend M;";
    const tree = parse(src);
    const node = identifierAt(tree, offsetOf(src, "Resistor") + 2);
    expect(node?.type).toBe("IDENT");
    expect(node?.text).toBe("Resistor");
  });

  it("returns a named node for a position on punctuation", () => {
    const src = "model M\n  Resistor r;\nend M;";
    const tree = parse(src);
    const node = nodeAt(tree, offsetOf(src, ";"));
    expect(node).not.toBeNull();
  });

  it("returns null when the cursor is on whitespace", () => {
    const src = "model M\n  Resistor r;\nend M;";
    const tree = parse(src);
    // The blank line indentation before `Resistor`.
    expect(identifierAt(tree, offsetOf(src, "  Resistor"))).toBeNull();
  });
});

describe("classify via targetAt", () => {
  it("classifies a component declaration type", () => {
    const src = "model M\n  Resistor r;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "Resistor") + 1);
    expect(t?.context).toBe("component-type");
    expect(t?.identifier).toBe("Resistor");
    expect(t?.path).toEqual(["Resistor"]);
  });

  it("classifies a dotted component type and reports the full path", () => {
    const src = "model M\n  Modelica.Electrical.Resistor r;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "Electrical") + 1);
    expect(t?.context).toBe("component-type");
    expect(t?.path).toEqual(["Modelica", "Electrical", "Resistor"]);
    expect(t?.pathToCursor).toEqual(["Modelica", "Electrical"]);
    expect(t?.identifier).toBe("Electrical");
  });

  it("classifies an extends clause type", () => {
    const src = "model M\n  extends Foo.Bar;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "Foo") + 1);
    expect(t?.context).toBe("extends");
    expect(t?.path).toEqual(["Foo", "Bar"]);
  });

  it("classifies the tail of a dotted extends clause", () => {
    const src = "model M\n  extends A.B.C;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "C;"));
    expect(t?.context).toBe("extends");
    expect(t?.identifier).toBe("C");
    expect(t?.pathToCursor).toEqual(["A", "B", "C"]);
  });

  it("classifies a modifier name", () => {
    const src = "model M\n  R r(k = 1);\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "k = 1"));
    expect(t?.context).toBe("modifier-name");
    expect(t?.identifier).toBe("k");
  });

  it("classifies a member access after a dot", () => {
    const src = "model M\nequation\n  y = r.v;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "v;"));
    expect(t?.context).toBe("member-access");
    expect(t?.identifier).toBe("v");
    expect(t?.path).toEqual(["r", "v"]);
    expect(t?.pathToCursor).toEqual(["r", "v"]);
  });

  it("classifies the head of a cref as a component reference, not a member", () => {
    const src = "model M\nequation\n  y = r.v;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "r.v"));
    expect(t?.context).toBe("component-reference");
    expect(t?.identifier).toBe("r");
    expect(t?.pathToCursor).toEqual(["r"]);
  });

  it("classifies a deep member access and truncates pathToCursor", () => {
    const src = "model M\nequation\n  y = a.b.c;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "b.c"));
    expect(t?.context).toBe("member-access");
    expect(t?.identifier).toBe("b");
    expect(t?.path).toEqual(["a", "b", "c"]);
    expect(t?.pathToCursor).toEqual(["a", "b"]);
  });

  it("classifies a bare cref as a component reference", () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const t = targetAt(parse(src), offsetOf(src, "x;"));
    expect(t?.context).toBe("component-reference");
    expect(t?.path).toEqual(["x"]);
  });

  it("returns null on keyword / non-identifier positions", () => {
    const src = "model M\n  Resistor r;\nend M;";
    // The `model` keyword tokenizes as a keyword, not an IDENT, at any offset
    // inside it.
    expect(targetAt(parse(src), offsetOf(src, "model"))).toBeNull();
    expect(targetAt(parse(src), offsetOf(src, "model") + 2)).toBeNull();
    // The class name `M` after the keyword IS an identifier, though.
    const cls = targetAt(parse(src), offsetOf(src, "M\n"));
    expect(cls?.identifier).toBe("M");
  });
});

describe("classify (direct)", () => {
  it("treats a name without a recognized slot as a type-reference", () => {
    // import clause uses a `name`; head segment lands as type-reference.
    const src = "model M\n  import A.B;\nend M;";
    const tree = parse(src);
    const ident = identifierAt(tree, offsetOf(src, "A.B"));
    expect(ident).not.toBeNull();
    // Direct classify with the enclosing dotted node resolved by targetAt.
    const t = targetAt(tree, offsetOf(src, "A.B"));
    expect(t?.context).toBe("type-reference");
  });

  it("is consistent between targetAt and classify on the same node", () => {
    const src = "model M\n  Resistor r;\nend M;";
    const tree = parse(src);
    const ident = identifierAt(tree, offsetOf(src, "Resistor") + 1);
    expect(ident).not.toBeNull();
    if (!ident) return;
    // The dotted `name` enclosing a single-segment type.
    const dotted = ident.parent;
    expect(classify(ident, dotted)).toBe("component-type");
  });
});

describe("textualWordBefore", () => {
  it("returns the bare prefix when the word has no dot", () => {
    const src = "  Res";
    expect(textualWordBefore(src, src.length)).toEqual({
      head: [],
      prefix: "Res",
    });
  });

  it("splits a single-dot word into head and (possibly empty) prefix", () => {
    expect(textualWordBefore("r.", 2)).toEqual({ head: ["r"], prefix: "" });
    expect(textualWordBefore("r.va", 4)).toEqual({
      head: ["r"],
      prefix: "va",
    });
  });

  it("splits a multi-dot word at the LAST dot", () => {
    expect(textualWordBefore("a.b.c", 5)).toEqual({
      head: ["a", "b"],
      prefix: "c",
    });
  });

  it("stops at non-word characters left of the caret", () => {
    const src = "x = foo.bar";
    expect(textualWordBefore(src, src.length)).toEqual({
      head: ["foo"],
      prefix: "bar",
    });
  });

  it("returns null when there is no word before the caret", () => {
    expect(textualWordBefore("   ", 3)).toBeNull();
    expect(textualWordBefore("", 0)).toBeNull();
    expect(textualWordBefore("a + b", 4)).toBeNull();
  });

  it("returns null for an empty head segment (leading or doubled dot)", () => {
    expect(textualWordBefore(".x", 2)).toBeNull();
    expect(textualWordBefore("a..b", 4)).toBeNull();
  });
});

describe("cursorInErrorRegion", () => {
  it("is false for a clean, well-formed buffer", () => {
    const src = "model M\n  Resistor r;\nend M;";
    const tree = parse(src);
    expect(cursorInErrorRegion(tree, offsetOf(src, "Resistor") + 1)).toBe(
      false,
    );
  });

  it("is false at the end of a clean buffer", () => {
    const src = "model M\nequation\n  y = x;\nend M;";
    const tree = parse(src);
    expect(cursorInErrorRegion(tree, offsetOf(src, "x;"))).toBe(false);
  });

  it("is true at the end of an unterminated declaration", () => {
    const src = "model M\n  Resistor r\n  Res";
    const tree = parse(src);
    expect(cursorInErrorRegion(tree, src.length)).toBe(true);
  });

  it("is true after a dangling member access in a broken buffer", () => {
    const src = "model M\n  R r\n  r.";
    const tree = parse(src);
    expect(cursorInErrorRegion(tree, src.length)).toBe(true);
  });
});

describe("modifiedTypeWithPath", () => {
  it("reports an empty path for a top-level modifier", () => {
    const src = "model M\n  Resistor r(R = 1);\nend M;";
    const got = modifiedTypeWithPath(parse(src), offsetOf(src, "R = 1"));
    expect(got).toEqual({ type: "Resistor", path: [] });
  });

  it("reports an empty path in empty parens", () => {
    const src = "model M\n  Resistor r();\nend M;";
    const got = modifiedTypeWithPath(parse(src), offsetOf(src, ")"));
    expect(got).toEqual({ type: "Resistor", path: [] });
  });

  it("captures a one-level nested modifier component name", () => {
    const src = "model M\n  Motor m(resistor());\nend M;";
    const got = modifiedTypeWithPath(parse(src), offsetOf(src, "())") + 1);
    expect(got).toEqual({ type: "Motor", path: ["resistor"] });
  });

  it("captures each level of a two-level nested modifier", () => {
    const src = "model M\n  Outer m(a(b()));\nend M;";
    const got = modifiedTypeWithPath(parse(src), offsetOf(src, "()))") + 1);
    expect(got).toEqual({ type: "Outer", path: ["a", "b"] });
  });

  it("reports the outer declaration's type for a nested modifier", () => {
    const src = "model M\n  Motor m(resistor());\nend M;";
    // Caret in the OUTER parens (after the inner modifier closes) is top-level.
    const got = modifiedTypeWithPath(parse(src), offsetOf(src, "));") + 1);
    expect(got).toEqual({ type: "Motor", path: [] });
  });

  it("returns null when the caret is outside any modifier list", () => {
    const src = "model M\n  Resistor r;\nend M;";
    expect(
      modifiedTypeWithPath(parse(src), offsetOf(src, "Resistor") + 1),
    ).toBe(null);
  });
});

describe("annotationPath", () => {
  it("reports an empty path directly inside annotation(...)", () => {
    const src = "model M\n  annotation();\nend M;";
    const got = annotationPath(parse(src), offsetOf(src, "()") + 1);
    expect(got).toEqual([]);
  });

  it("captures a one-level annotation record", () => {
    const src = "model M\n  annotation(Placement());\nend M;";
    const got = annotationPath(parse(src), offsetOf(src, "())") + 1);
    expect(got).toEqual(["Placement"]);
  });

  it("captures a two-level annotation record path", () => {
    const src = "model M\n  annotation(Placement(transformation()));\nend M;";
    const got = annotationPath(parse(src), offsetOf(src, "()))") + 1);
    expect(got).toEqual(["Placement", "transformation"]);
  });

  it("classifies a component modifier as not an annotation", () => {
    const src = "model M\n  R r(R());\nend M;";
    expect(annotationPath(parse(src), offsetOf(src, "())") + 1)).toBe(null);
  });

  it("returns null when the caret is outside any annotation", () => {
    const src = "model M\n  Resistor r;\nend M;";
    expect(annotationPath(parse(src), offsetOf(src, "Resistor") + 1)).toBe(
      null,
    );
  });
});

describe("annotationValueField", () => {
  it("names the field for an empty value (field = │)", () => {
    const src = "model M\n  annotation(Rectangle(fillPattern = ));\nend M;";
    const offset = offsetOf(src, "= ") + 2;
    expect(annotationValueField(parse(src), offset)).toBe("fillPattern");
  });

  it("names the field after the enum dot (field = Enum.│)", () => {
    const src =
      "model M\n  annotation(Rectangle(fillPattern = FillPattern.));\nend M;";
    const offset = offsetOf(src, "FillPattern.") + "FillPattern.".length;
    expect(annotationValueField(parse(src), offset)).toBe("fillPattern");
  });

  it("names the field within a complete value (field = Enum.Member)", () => {
    const src =
      "model M\n  annotation(Rectangle(fillPattern = FillPattern.Solid));\nend M;";
    const offset = offsetOf(src, "FillPattern.Solid") + 2;
    expect(annotationValueField(parse(src), offset)).toBe("fillPattern");
  });

  it("names the field for a braced array element (field = {Enum.│})", () => {
    const src = "model M\n  annotation(Line(smooth = {Smooth.}));\nend M;";
    const offset = offsetOf(src, "Smooth.") + "Smooth.".length;
    expect(annotationValueField(parse(src), offset)).toBe("smooth");
  });

  it("names a boolean field for an empty value (visible = │)", () => {
    const src = "model M\n  annotation(Rectangle(visible = ));\nend M;";
    const offset = offsetOf(src, "= ") + 2;
    expect(annotationValueField(parse(src), offset)).toBe("visible");
  });

  it("names the second field when a prior one is complete", () => {
    const src =
      "model M\n  annotation(Rectangle(visible = true, fillPattern = ));\nend M;";
    const offset = offsetOf(src, "fillPattern = ") + "fillPattern = ".length;
    expect(annotationValueField(parse(src), offset)).toBe("fillPattern");
  });

  it("returns null on the field-NAME slot (no value-completion takeover)", () => {
    const src =
      "model M\n  annotation(Rectangle(fillPattern = FillPattern.Solid));\nend M;";
    const offset = offsetOf(src, "fillPattern") + 1;
    expect(annotationValueField(parse(src), offset)).toBe(null);
  });

  it("returns null in a fresh field-name slot after a comma", () => {
    const src = "model M\n  annotation(Rectangle(visible = true, ));\nend M;";
    const offset = offsetOf(src, "true, ") + "true, ".length;
    expect(annotationValueField(parse(src), offset)).toBe(null);
  });

  it("returns null in an empty record's field-name slot", () => {
    const src = "model M\n  annotation(Rectangle());\nend M;";
    const offset = offsetOf(src, "Rectangle(") + "Rectangle(".length;
    expect(annotationValueField(parse(src), offset)).toBe(null);
  });

  it("returns null for a component modifier value (not an annotation)", () => {
    const src = "model M\n  Resistor r(R = );\nend M;";
    const offset = offsetOf(src, "= ") + 2;
    expect(annotationValueField(parse(src), offset)).toBe(null);
  });
});
