import { describe, expect, it } from "vitest";

import {
  expressionFault,
  modelicaExpr,
  modelicaName,
  resultVariable,
} from "./fields.js";

describe("the name a field is held to", () => {
  it("accepts the shapes a cref reaching OMC actually carries", () => {
    for (const s of [
      "Gain",
      "Modelica.Blocks.Math.Gain",
      "a.p",
      "pins[3].p",
      "a[1, 2].p",
      "ports[i]",
      "values[end]",
      "v[1:n]",
      "pins[i + 1]",
      "pins[2*n-1]",
      "a[b.c]",
      "'a class'.p",
      "'has.a.dot'",
      "'quoted )'",
    ]) {
      expect(modelicaName.safeParse(s).success).toBe(true);
    }
  });

  it("refuses anything that would not lex as one name", () => {
    for (const s of [
      "",
      'b.p); loadString("model X end X;"); addConnection(a.p, b.p, Demo.MSD',
      "a.p)",
      "a.p; b",
      "1a",
      "a b",
      "a.'unterminated",
      "a[1)].p",
      "a['x'].p",
      'a["x"].p',
      "a[x;y].p",
      "a[b[1]].p",
    ]) {
      expect(modelicaName.safeParse(s).success).toBe(false);
    }
  });
});

describe("the expression a field is held to", () => {
  it("accepts a self-contained expression", () => {
    for (const s of [
      "",
      "Placement(transformation(extent = {{-10, -10}, {10, 10}}))",
      'Documentation(info = "a ) is fine inside a string")',
      "{1, 2}",
      "[1, 2; 3, 4]",
      "record.'a,b'",
      "Line(points = {{0, 0}}, color = 'weird )name')",
    ]) {
      expect(expressionFault(s)).toBeUndefined();
      expect(modelicaExpr.safeParse(s).success).toBe(true);
    }
  });

  it("names why an expression would leave its argument position", () => {
    for (const [s, why] of [
      [
        'Placement()); loadString("model X end X;"); addComponent(a, B, C, annotate=Placement(',
        "closes a bracket it did not open",
      ],
      ["Line(), extraArgument", "separates arguments at the top level"],
      ["Line(", "leaves a bracket open"],
      ["Line('unterminated", "leaves a quoted identifier open"],
      [
        "'a'); loadString(\"model X end X;\"); f(",
        "closes a bracket it did not open",
      ],
      ['Line(color = "unterminated', "leaves a string literal open"],
      ["Line() // rest of the command", "comments out the rest of the command"],
    ] as const) {
      expect(expressionFault(s)).toBe(why);
      expect(modelicaExpr.safeParse(s).success).toBe(false);
    }
  });
});

describe("the variable a result field is held to", () => {
  it("accepts a derivative, which is how OMC names one in a result file", () => {
    for (const s of ["x", "body.r[1]", "der(x)", "der(body.r[1])"]) {
      expect(resultVariable.safeParse(s).success).toBe(true);
    }
  });

  it("still refuses a call that is not der", () => {
    for (const s of ["f(x)", "der(x), g(", "der(x))", "der(", "der()"]) {
      expect(resultVariable.safeParse(s).success).toBe(false);
    }
  });
});
