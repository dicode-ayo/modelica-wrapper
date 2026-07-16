import { describe, expect, it } from "vitest";

import { expressionToString } from "./expression.js";
import type { Expression } from "./types.js";

function cref(...names: string[]): Expression {
  return { $kind: "cref", parts: names.map((name) => ({ name })) };
}

function bin(op: string, lhs: Expression, rhs: Expression): Expression {
  return { $kind: "binary_op", op, lhs, rhs };
}

function un(op: string, exp: Expression): Expression {
  return { $kind: "unary_op", op, exp };
}

describe("expressionToString", () => {
  it("passes primitives through", () => {
    expect(expressionToString("abc")).toBe("abc");
    expect(expressionToString(2.5)).toBe("2.5");
    expect(expressionToString(true)).toBe("true");
    expect(expressionToString(null)).toBe("");
    expect(expressionToString(undefined)).toBe("");
  });

  it("renders a cref as a dotted path", () => {
    expect(expressionToString(cref("controller", "k"))).toBe("controller.k");
  });

  it("unwraps DynamicSelect to its static default", () => {
    expect(
      expressionToString({
        $kind: "call",
        name: "DynamicSelect",
        arguments: [cref("k"), cref("live")],
      }),
    ).toBe("k");
  });

  it("renders an enum literal by its qualified name", () => {
    expect(
      expressionToString({
        $kind: "enum",
        name: "Modelica.Blocks.Types.Init.InitialState",
        index: 3,
      }),
    ).toBe("Modelica.Blocks.Types.Init.InitialState");
  });

  it("renders flat arithmetic without parentheses", () => {
    expect(expressionToString(bin("*", 2, cref("pi")))).toBe("2 * pi");
    expect(
      expressionToString(bin("+", bin("+", cref("a"), cref("b")), 1)),
    ).toBe("a + b + 1");
  });

  it("parenthesizes a looser-bound operand on either side", () => {
    expect(expressionToString(bin("*", 2, bin("+", cref("a"), 1)))).toBe(
      "2 * (a + 1)",
    );
    expect(expressionToString(bin("*", bin("+", cref("a"), 1), 2))).toBe(
      "(a + 1) * 2",
    );
    expect(expressionToString(bin("*", un("-", cref("a")), cref("b")))).toBe(
      "(-a) * b",
    );
  });

  it("parenthesizes nested exponentiation on either side", () => {
    expect(expressionToString(bin("^", bin("^", cref("a"), 2), 3))).toBe(
      "(a ^ 2) ^ 3",
    );
    expect(expressionToString(bin("^", cref("a"), bin("^", 2, 3)))).toBe(
      "a ^ (2 ^ 3)",
    );
  });

  it("parenthesizes the right side of a non-associative chain", () => {
    expect(
      expressionToString(bin("-", cref("a"), bin("-", cref("b"), cref("c")))),
    ).toBe("a - (b - c)");
  });

  it("renders unary minus per MLS precedence", () => {
    // `-a * b` parses as `-(a * b)` — no parentheses needed.
    expect(expressionToString(un("-", bin("*", cref("a"), cref("b"))))).toBe(
      "-a * b",
    );
    expect(expressionToString(un("-", bin("+", cref("a"), cref("b"))))).toBe(
      "-(a + b)",
    );
    // A sign is only writable at the start of an arithmetic expression.
    expect(expressionToString(bin("*", 2, un("-", 3)))).toBe("2 * (-3)");
  });

  it("spaces word operators", () => {
    expect(expressionToString(un("not", cref("enabled")))).toBe("not enabled");
    expect(
      expressionToString(bin("and", cref("a"), un("not", cref("b")))),
    ).toBe("a and (not b)");
  });

  it("falls back to empty for unrenderable nodes", () => {
    expect(expressionToString([1, 2] as Expression)).toBe("");
    expect(
      expressionToString({ $kind: "record", name: "R", elements: [] }),
    ).toBe("");
    expect(
      expressionToString(
        bin("*", 2, { $kind: "record", name: "R", elements: [] }),
      ),
    ).toBe("");
    expect(
      expressionToString({
        $kind: "call",
        name: "sin",
        arguments: [cref("x")],
      }),
    ).toBe("");
  });
});
