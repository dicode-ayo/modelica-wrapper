import { describe, expect, it } from "vitest";

import type { CallContext } from "./callContext.js";
import { addConnection } from "../api/editing/addConnection.js";
import { bareExpr, bareName } from "./format.js";

describe("bareName", () => {
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
      expect(bareName(s)).toBe(s);
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
      expect(() => bareName(s)).toThrow(/not a Modelica name/);
    }
  });
});

describe("bareExpr", () => {
  it("accepts a self-contained expression", () => {
    for (const s of [
      "",
      "Placement(transformation(extent = {{-10, -10}, {10, 10}}))",
      'Documentation(info = "a ) is fine inside a string")',
      "{1, 2}",
      "[1, 2; 3, 4]",
    ]) {
      expect(bareExpr(s)).toBe(s);
    }
  });

  it("refuses an expression that leaves its argument position", () => {
    for (const s of [
      'Placement()); loadString("model X end X;"); addComponent(a, B, C, annotate=Placement(',
      "Line(), extraArgument",
      "Line(",
      'Line(color = "unterminated',
      "Line() // the rest of the command is now a comment",
    ]) {
      expect(() => bareExpr(s)).toThrow(/cannot be sent to OMC/);
    }
  });
});

describe("a wrapper's arguments", () => {
  it("refuses a connector reference that would close the call", async () => {
    const calls: string[] = [];
    const ctx: CallContext = {
      call: (cmd) => {
        calls.push(cmd);
        return Promise.resolve("true");
      },
      getErrorString: () => Promise.resolve({ errorString: "" }),
    };
    await expect(
      addConnection(ctx, {
        from: "a.p",
        to: 'b.p); loadString("model Injected end Injected;"); addConnection(a.p, b.p, Demo.MSD',
        typeName: "Demo.MSD",
      }),
    ).rejects.toThrow(/not a Modelica name/);
    expect(calls).toEqual([]);
  });
});
