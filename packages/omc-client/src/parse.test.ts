import { describe, expect, it } from "vitest";

import getElementsFixture from "../test/fixtures/getElements-Modelica.Blocks.Examples.PID_Controller.txt?raw";
import getElementsInfoFixture from "../test/fixtures/getElementsInfo-Modelica.Blocks.Examples.PID_Controller.txt?raw";
import { isNull, parse, toJson } from "./parse.js";

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
        { kind: "list", items: [{ kind: "int", value: 1 }, { kind: "int", value: 2 }] },
        { kind: "list", items: [{ kind: "int", value: 3 }, { kind: "int", value: 4 }] },
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
    expect(v.items.map(isNull)).toEqual([false, true, false, true, true, false]);
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
