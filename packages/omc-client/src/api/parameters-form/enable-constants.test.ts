import { describe, expect, it, vi } from "vitest";

import type { Expression } from "../../_shared/modelInstance.js";
import {
  collectEnableConstantNames,
  resolveEnableConstants,
  type EnableConstantClient,
} from "./enable-constants.js";
import type { ParameterField, ParameterModel } from "./types.js";

const cref = (...names: string[]): Expression => ({
  $kind: "cref",
  parts: names.map((name) => ({ name })),
});

const gt = (lhs: Expression, rhs: Expression): Expression => ({
  $kind: "binary_op",
  op: ">",
  lhs,
  rhs,
});

function field(name: string, enable?: Expression): ParameterField {
  return {
    name,
    label: name,
    kind: "number",
    value: 0,
    dialog: { tab: "General", group: "Parameters", enable },
    unitOptions: [],
  };
}

function model(fields: ParameterField[], component?: string): ParameterModel {
  return { className: "Test.C", component, fields };
}

describe("collectEnableConstantNames", () => {
  it("collects a library constant compared against a peer", () => {
    const m = model([
      field("k"),
      field("y", gt(cref("k"), cref("Modelica", "Constants", "eps"))),
    ]);
    expect(collectEnableConstantNames(m)).toEqual(["Modelica.Constants.eps"]);
  });

  it("skips what the form resolves locally: peers, peer members, the component prefix", () => {
    const m = model(
      [
        field("use_reset"),
        field("r"),
        field("a", cref("use_reset")),
        field("b", cref("r", "x")),
        field("c", cref("PI", "controllerType")),
      ],
      "PI",
    );
    expect(collectEnableConstantNames(m)).toEqual([]);
  });

  it("never returns a subscripted or quoted cref", () => {
    const subscripted: Expression = {
      $kind: "cref",
      parts: [{ name: "Lib" }, { name: "table", subscripts: [1] }],
    };
    const m = model([
      field("a", subscripted),
      field("b", cref("Lib", "'odd.name'")),
      field("c", cref("Lib", "x y")),
    ]);
    expect(collectEnableConstantNames(m)).toEqual([]);
  });

  it("walks nested operators, calls and if-branches, deduplicating", () => {
    const eps = cref("Modelica", "Constants", "eps");
    const m = model([
      field("k"),
      field("a", {
        $kind: "if",
        condition: { $kind: "unary_op", op: "not", exp: cref("Lib", "flag") },
        true: { $kind: "call", name: "abs", arguments: [eps] },
        false: gt(cref("k"), eps),
      }),
      field("b", gt(cref("k"), eps)),
    ]);
    expect(collectEnableConstantNames(m).sort()).toEqual([
      "Lib.flag",
      "Modelica.Constants.eps",
    ]);
  });
});

describe("resolveEnableConstants", () => {
  it("carries each value OMC reduces, keyed by the dotted name", async () => {
    const client: EnableConstantClient = {
      evaluateConstant: vi.fn(async () => ({ value: 1e-15 })),
    };
    const m = model([
      field("k"),
      field("y", gt(cref("k"), cref("Modelica", "Constants", "eps"))),
      field("z", gt(cref("k"), cref("Modelica", "Constants", "eps"))),
    ]);
    const out = await resolveEnableConstants(client, m);
    expect(out.constants).toEqual({ "Modelica.Constants.eps": 1e-15 });
    expect(client.evaluateConstant).toHaveBeenCalledTimes(1);
  });

  it("leaves out a name that fails or comes back non-literal", async () => {
    const client: EnableConstantClient = {
      evaluateConstant: async ({ name }) => {
        if (name === "Lib.missing") throw new Error("not found");
        if (name === "Lib.rec") {
          return { value: { re: 1 } } as unknown as { value: number };
        }
        if (name === "Lib.inf") return { value: Number.POSITIVE_INFINITY };
        return { value: true };
      },
    };
    const m = model([
      field("a", cref("Lib", "missing")),
      field("b", cref("Lib", "rec")),
      field("c", cref("Lib", "inf")),
      field("d", cref("Lib", "flag")),
    ]);
    expect((await resolveEnableConstants(client, m)).constants).toEqual({
      "Lib.flag": true,
    });
  });

  it("returns the model untouched when nothing needs or yields a value", async () => {
    const evaluateConstant = vi.fn(async () => {
      throw new Error("not found");
    });
    const none = model([field("a", cref("use_x")), field("use_x")]);
    expect(await resolveEnableConstants({ evaluateConstant }, none)).toBe(none);
    expect(evaluateConstant).not.toHaveBeenCalled();

    const failing = model([field("a", cref("Lib", "missing"))]);
    expect(await resolveEnableConstants({ evaluateConstant }, failing)).toBe(
      failing,
    );
  });
});
