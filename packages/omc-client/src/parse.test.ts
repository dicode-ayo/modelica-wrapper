import { describe, expect, it } from "vitest";

import getElementsFixture from "../test/fixtures/getElements-Modelica.Blocks.Examples.PID_Controller.txt?raw";
import getElementsInfoFixture from "../test/fixtures/getElementsInfo-Modelica.Blocks.Examples.PID_Controller.txt?raw";
import { isNull, parse, parseLeading, toJson } from "./parse.js";

describe("parse: scalars", () => {
  it.each([
    [`"hello"`, { kind: "string", value: "hello" }],
    [`"with \\"quotes\\""`, { kind: "string", value: `with "quotes"` }],
    [`"escapes \\n\\t\\\\"`, { kind: "string", value: "escapes \n\t\\" }],
    [`true`, { kind: "bool", value: true }],
    [`false`, { kind: "bool", value: false }],
    [`42`, { kind: "int", value: 42 }],
    [`-7`, { kind: "int", value: -7 }],
    [`3.14`, { kind: "float", value: 3.14 }],
    [`1e-6`, { kind: "float", value: 1e-6 }],
    [`1.5E3`, { kind: "float", value: 1500 }],
    [`Modelica.Blocks.Math`, { kind: "ident", name: "Modelica.Blocks.Math" }],
    [``, { kind: "null" }],
    [`   \n  `, { kind: "null" }],
  ])("parses %s", (input, want) => {
    expect(parse(input as string)).toEqual(want);
  });
});

describe("parse: lists and tuples", () => {
  it("parses empty list", () => {
    expect(parse(`{}`)).toEqual({ kind: "list", items: [] });
  });

  it("parses int list", () => {
    expect(parse(`{1, 2, 3}`)).toEqual({
      kind: "list",
      items: [
        { kind: "int", value: 1 },
        { kind: "int", value: 2 },
        { kind: "int", value: 3 },
      ],
    });
  });

  it("parses identifier list", () => {
    expect(parse(`{Modelica, Complex}`)).toEqual({
      kind: "list",
      items: [
        { kind: "ident", name: "Modelica" },
        { kind: "ident", name: "Complex" },
      ],
    });
  });

  it("parses nested lists", () => {
    expect(parse(`{{1,2},{3,4}}`)).toEqual({
      kind: "list",
      items: [
        {
          kind: "list",
          items: [
            { kind: "int", value: 1 },
            { kind: "int", value: 2 },
          ],
        },
        {
          kind: "list",
          items: [
            { kind: "int", value: 3 },
            { kind: "int", value: 4 },
          ],
        },
      ],
    });
  });

  it("parses getClassInformation-style 22-field tuple", () => {
    const input = `("block", "doc", false, false, false, "/path/file.mo", false, 1175, 3, 1220, 10, {}, false, false, "", "", false, "", "", "", "", "")`;
    const v = parse(input);
    expect(v.kind).toBe("list");
    if (v.kind !== "list") throw new Error("unreachable");
    expect(v.items).toHaveLength(22);
    expect(v.items[0]).toEqual({ kind: "string", value: "block" });
    expect(v.items[7]).toEqual({ kind: "int", value: 1175 });
  });
});

describe("parse: null sentinels", () => {
  it("parses bare `-` and empty positions as null", () => {
    const v = parse(`{a, -, b, ,, c}`);
    expect(v.kind).toBe("list");
    if (v.kind !== "list") throw new Error("unreachable");
    expect(v.items).toHaveLength(6);
    expect(v.items.map(isNull)).toEqual([
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("parse: function calls", () => {
  it("parses Polygon-style annotation calls", () => {
    const v = parse(`Polygon(true, {0.0, 0.0}, 0.0, Smooth.None)`);
    expect(v.kind).toBe("call");
    if (v.kind !== "call") throw new Error("unreachable");
    expect(v.name).toBe("Polygon");
    expect(v.args).toHaveLength(4);
  });

  it("parses the `$Code( = 1.0)` modification form from getNthComponentModification", () => {
    // OMC returns `{$Code( = 1.0)}` for a modified component. The leading-`=`
    // binding inside the parens has no LHS ident; it parses to a `call` named
    // "=" carrying the bound value.
    const v = parse(`{$Code( = 1.0)}`);
    expect(v.kind).toBe("list");
    if (v.kind !== "list") throw new Error("unreachable");
    const code = v.items[0];
    expect(code).toMatchObject({ kind: "call", name: "$Code" });
    if (code?.kind !== "call") throw new Error("unreachable");
    expect(code.args).toEqual([
      { kind: "call", name: "=", args: [{ kind: "float", value: 1.0 }] },
    ]);
  });
});

describe("parse: documentation strings with newlines", () => {
  it("preserves newlines inside string literals", () => {
    const input = `{"<html>\n<p>hi</p>\n</html>"}`;
    const v = parse(input);
    if (v.kind !== "list") throw new Error("expected list");
    expect(v.items[0]).toEqual({
      kind: "string",
      value: "<html>\n<p>hi</p>\n</html>",
    });
  });
});

describe("parse: trailing newline tolerated", () => {
  it("ignores OMC's trailing newline", () => {
    expect(parse(`true\n`)).toEqual({ kind: "bool", value: true });
  });
});

describe("parseLeading: tolerant parse with trailing capture", () => {
  it("parses a clean bool with empty trailing", () => {
    expect(parseLeading(`true`)).toEqual({
      value: { kind: "bool", value: true },
      trailing: "",
    });
  });

  it("treats a lone trailing newline as no trailing", () => {
    expect(parseLeading(`false\n`)).toEqual({
      value: { kind: "bool", value: false },
      trailing: "",
    });
  });

  it("captures a diagnostic line appended by OMC after a failed mutation", () => {
    // Shape mirrors what some OMC builds emit for addComponent when
    // building the AST fails — the bool, a newline, then prose.
    const raw = `false\nError occurred building AST`;
    expect(parseLeading(raw)).toEqual({
      value: { kind: "bool", value: false },
      trailing: "Error occurred building AST",
    });
  });

  it("trims whitespace around the trailing diagnostic", () => {
    const raw = `false\n  \n  some message  \n`;
    expect(parseLeading(raw)).toEqual({
      value: { kind: "bool", value: false },
      trailing: "some message",
    });
  });

  it("yields a null value with empty trailing for whitespace-only input", () => {
    expect(parseLeading(`   \n  `)).toEqual({
      value: { kind: "null" },
      trailing: "",
    });
  });

  it("works on non-boolean leading values too", () => {
    // Generic primitive — also useful for list-returning mutations
    // that may emit trailing diagnostics.
    expect(parseLeading(`{1, 2, 3}\nwarning: deprecated`)).toEqual({
      value: {
        kind: "list",
        items: [
          { kind: "int", value: 1 },
          { kind: "int", value: 2 },
          { kind: "int", value: 3 },
        ],
      },
      trailing: "warning: deprecated",
    });
  });
});

describe("toJson", () => {
  it("converts a parsed icon-style tree to JSON", () => {
    const v = parse(`{0, true, Polygon(true, {1,2}, Smooth.None)}`);
    expect(toJson(v)).toEqual([
      0,
      true,
      { _call: "Polygon", args: [true, [1, 2], "Smooth.None"] },
    ]);
  });

  it("renders null as null", () => {
    expect(toJson(parse(`{a, -, b}`))).toEqual(["a", null, "b"]);
  });
});

describe("parse: $-prefixed identifiers", () => {
  it("parses $Any as an identifier", () => {
    expect(parse(`$Any`)).toEqual({ kind: "ident", name: "$Any" });
  });

  it("parses a list containing $Any", () => {
    const v = parse(`{"x", $Any, {}}`);
    if (v.kind !== "list") throw new Error("expected list");
    expect(v.items[1]).toEqual({ kind: "ident", name: "$Any" });
  });
});

describe("parse: keyword arguments inside calls", () => {
  it("parses a record-style call with kwargs", () => {
    const v = parse(`rec(name = "x", value = 42, flag = false)`);
    expect(v.kind).toBe("call");
    if (v.kind !== "call") throw new Error("unreachable");
    expect(v.name).toBe("rec");
    expect(v.args).toEqual([
      { kind: "kwarg", name: "name", value: { kind: "string", value: "x" } },
      { kind: "kwarg", name: "value", value: { kind: "int", value: 42 } },
      { kind: "kwarg", name: "flag", value: { kind: "bool", value: false } },
    ]);
  });

  it("parses kwargs whose value is a brace list", () => {
    const v = parse(`rec(names = {a, "b"})`);
    if (v.kind !== "call") throw new Error("unreachable");
    const kw = v.args[0];
    if (!kw || kw.kind !== "kwarg") throw new Error("expected kwarg");
    expect(kw.name).toBe("names");
    expect(kw.value.kind).toBe("list");
  });

  it("parses kwargs alongside positional args", () => {
    const v = parse(`f(1, "x", flag = true)`);
    if (v.kind !== "call") throw new Error("unreachable");
    expect(v.args[0]).toEqual({ kind: "int", value: 1 });
    expect(v.args[1]).toEqual({ kind: "string", value: "x" });
    expect(v.args[2]).toEqual({
      kind: "kwarg",
      name: "flag",
      value: { kind: "bool", value: true },
    });
  });
});

describe("parse: quoted identifiers (Q-IDENT, Modelica spec §2.3.1)", () => {
  it("parses 'foo bar' as an identifier whose name has a space", () => {
    expect(parse(`'foo bar'`)).toEqual({ kind: "ident", name: "foo bar" });
  });

  it("handles escaped single-quote inside the name", () => {
    expect(parse(`'with \\'q\\''`)).toEqual({
      kind: "ident",
      name: "with 'q'",
    });
  });

  it("handles a backslash escape inside the name", () => {
    expect(parse(`'a\\\\b'`)).toEqual({ kind: "ident", name: "a\\b" });
  });

  it("reads a quoted ident inside a list", () => {
    const v = parse(`{"x", 'a b', 1}`);
    if (v.kind !== "list") throw new Error("expected list");
    expect(v.items[1]).toEqual({ kind: "ident", name: "a b" });
  });

  it("throws on an unterminated quoted ident", () => {
    expect(() => parse(`'unterminated`)).toThrow(/unterminated '/);
  });

  // `searchClassNames` returns these for Complex's operator overloads. The
  // parsed name is fed straight back to OMC as a command argument, so its
  // quotes have to survive the round trip.
  it("keeps a quoted segment inside a dotted class name", () => {
    expect(parse(`Complex.'-'.negate`)).toEqual({
      kind: "ident",
      name: `Complex.'-'.negate`,
    });
  });

  it("keeps every quoted segment in a list of class names", () => {
    const v = parse(
      `{Complex.'constructor'.fromReal, Complex.'*'.scalarProduct, Modelica}`,
    );
    if (v.kind !== "list") throw new Error("expected list");
    expect(v.items.map((i) => (i.kind === "ident" ? i.name : i.kind))).toEqual([
      `Complex.'constructor'.fromReal`,
      `Complex.'*'.scalarProduct`,
      "Modelica",
    ]);
  });

  it("does not mistake a quoted `-` segment for the null sentinel", () => {
    const v = parse(`{Complex.'-'.subtract, -}`);
    if (v.kind !== "list") throw new Error("expected list");
    expect(v.items[0]).toEqual({
      kind: "ident",
      name: `Complex.'-'.subtract`,
    });
    expect(v.items[1]?.kind).toBe("null");
  });

  it("reads a dotted name that opens with a quoted segment", () => {
    expect(parse(`'a b'.c`)).toEqual({ kind: "ident", name: `'a b'.c` });
  });

  // A dot inside a quoted segment is part of the name, not a separator. This is
  // the invariant a scanner that stopped at `.` would break.
  it("keeps a dot inside a quoted segment from splitting the name", () => {
    expect(parse(`Complex.'a.b'.negate`)).toEqual({
      kind: "ident",
      name: `Complex.'a.b'.negate`,
    });
  });

  it("keeps a name that ends in a quoted segment", () => {
    expect(parse(`Complex.'-'`)).toEqual({
      kind: "ident",
      name: `Complex.'-'`,
    });
  });

  it("keeps an escaped quote inside a dotted segment", () => {
    // Source text is Pkg.'it\'s'.f — the escape must not close the segment.
    expect(parse(`Pkg.'it\\'s'.f`)).toEqual({
      kind: "ident",
      name: `Pkg.'it\\'s'.f`,
    });
  });
});

describe("parse: leading-dot qualified idents", () => {
  it("parses a fully-qualified enum literal as a single ident", () => {
    expect(parse(`.OpenModelica.Scripting.ErrorKind.syntax`)).toEqual({
      kind: "ident",
      name: ".OpenModelica.Scripting.ErrorKind.syntax",
    });
  });

  it("preserves leading-dot idents inside a brace list", () => {
    const v = parse(`{.A.B.C, 1}`);
    if (v.kind !== "list") throw new Error("expected list");
    expect(v.items[0]).toEqual({ kind: "ident", name: ".A.B.C" });
    expect(v.items[1]).toEqual({ kind: "int", value: 1 });
  });
});

describe("parse: record blocks (legacy diagnostic syntax)", () => {
  it("parses a flat record into a call with kwargs", () => {
    const src = `record OpenModelica.Scripting.SourceInfo
    filename = "x.mo",
    readonly = false,
    lineStart = 3,
    columnStart = 3,
    lineEnd = 3,
    columnEnd = 3
end OpenModelica.Scripting.SourceInfo;`;
    const v = parse(src);
    expect(v.kind).toBe("call");
    if (v.kind !== "call") throw new Error("unreachable");
    expect(v.name).toBe("OpenModelica.Scripting.SourceInfo");
    const names = v.args
      .filter((a) => a.kind === "kwarg")
      .map((a) => (a.kind === "kwarg" ? a.name : ""));
    expect(names).toEqual([
      "filename",
      "readonly",
      "lineStart",
      "columnStart",
      "lineEnd",
      "columnEnd",
    ]);
  });

  it("parses a nested record (info field holding a SourceInfo record)", () => {
    const src = `{record OpenModelica.Scripting.ErrorMessage
    info = record OpenModelica.Scripting.SourceInfo
    filename = "mw-probe-syntax.mo",
    readonly = false,
    lineStart = 3,
    columnStart = 3,
    lineEnd = 3,
    columnEnd = 3
end OpenModelica.Scripting.SourceInfo;,
    message = "Missing token: SEMICOLON",
    kind = .OpenModelica.Scripting.ErrorKind.syntax,
    level = .OpenModelica.Scripting.ErrorLevel.error,
    id = 2
end OpenModelica.Scripting.ErrorMessage;}`;
    const v = parse(src);
    if (v.kind !== "list") throw new Error("expected outer list");
    expect(v.items).toHaveLength(1);
    const rec = v.items[0]!;
    if (rec.kind !== "call") throw new Error("expected call");
    expect(rec.name).toBe("OpenModelica.Scripting.ErrorMessage");
    const message = rec.args.find(
      (a) => a.kind === "kwarg" && a.name === "message",
    );
    expect(message).toEqual({
      kind: "kwarg",
      name: "message",
      value: { kind: "string", value: "Missing token: SEMICOLON" },
    });
    const kindKw = rec.args.find(
      (a) => a.kind === "kwarg" && a.name === "kind",
    );
    if (!kindKw || kindKw.kind !== "kwarg") throw new Error("missing kind");
    expect(kindKw.value).toEqual({
      kind: "ident",
      name: ".OpenModelica.Scripting.ErrorKind.syntax",
    });
    const info = rec.args.find((a) => a.kind === "kwarg" && a.name === "info");
    if (!info || info.kind !== "kwarg") throw new Error("missing info");
    if (info.value.kind !== "call") throw new Error("info value not a call");
    expect(info.value.name).toBe("OpenModelica.Scripting.SourceInfo");
  });
});

describe("parse: real OMC fixtures", () => {
  it("parses captured getElements response", () => {
    const v = parse(getElementsFixture);
    expect(v.kind).toBe("list");
    if (v.kind !== "list") throw new Error("unreachable");
    expect(v.items.length).toBeGreaterThan(0);
    // Each row is itself a list; the 13th column is the `$Any` ident.
    const first = v.items[0];
    if (!first || first.kind !== "list") throw new Error("expected list row");
    expect(first.items).toContainEqual({ kind: "ident", name: "$Any" });
  });

  it("parses captured getElementsInfo response", () => {
    const v = parse(getElementsInfoFixture);
    expect(v.kind).toBe("list");
    if (v.kind !== "list") throw new Error("unreachable");
    expect(v.items.length).toBeGreaterThan(0);
    // Each entry is `{ rec(...) }` — a singleton list wrapping a call.
    const first = v.items[0];
    if (!first || first.kind !== "list") throw new Error("expected list row");
    const inner = first.items[0];
    if (!inner || inner.kind !== "call") throw new Error("expected call");
    expect(inner.name).toBe("rec");
    expect(
      inner.args.some(
        (a) => a.kind === "kwarg" && a.name === "elementvisibility",
      ),
    ).toBe(true);
  });
});
