import { describe, expect, it } from "vitest";

import { modelicaExpr, modelicaName } from "./fields.js";
import { expressionFault } from "./format.js";

describe("the name a field is held to", () => {
  it("accepts the shapes a cref reaching OMC actually carries", () => {
    for (const s of [
      "Gain",
      "Modelica.Blocks.Math.Gain",
      "a.p",
      "pins[3].p",
      "a[1, 2].p",
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
      ['Line(color = "unterminated', "leaves a string literal open"],
      ["Line() // rest of the command", "comments out the rest of the command"],
    ] as const) {
      expect(expressionFault(s)).toBe(why);
      expect(modelicaExpr.safeParse(s).success).toBe(false);
    }
  });
});
