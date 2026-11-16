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

function inherited(
  f: ParameterField,
  declaredIn: string,
  inheritedFrom = declaredIn,
): ParameterField {
  return { ...f, declaredIn, inheritedFrom };
}

function model(
  fields: ParameterField[],
  component?: string,
  ancestors?: string[],
): ParameterModel {
  return { className: "Test.C", component, fields, ancestors };
}

const LOADED = ["Modelica", "Lib", "Test"];

/**
 * A client that qualifies `path` in `typeName` through `scopes` (keyed
 * `typeName|path`), else hands `path` back unchanged as OMC does, and
 * evaluates names from `values`.
 */
function fakeClient(opts: {
  values: Record<string, number | boolean | string>;
  scopes?: Record<string, string>;
  loaded?: string[];
}): EnableConstantClient & {
  qualifyPath: ReturnType<typeof vi.fn>;
  getClassNames: ReturnType<typeof vi.fn>;
  evaluateConstant: ReturnType<typeof vi.fn>;
} {
  return {
    qualifyPath: vi.fn(
      async ({ typeName, path }: { typeName: string; path: string }) => ({
        qualifiedPath: opts.scopes?.[`${typeName}|${path}`] ?? path,
      }),
    ),
    getClassNames: vi.fn(async () => ({ classNames: opts.loaded ?? LOADED })),
    evaluateConstant: vi.fn(async ({ name }: { name: string }) => {
      const value = opts.values[name];
      if (value === undefined) throw new Error(`not found: ${name}`);
      return { value };
    }),
  };
}

describe("collectEnableConstantNames", () => {
  it("collects a library constant compared against a peer, with its declaring class", () => {
    const m = model([
      field("k"),
      field("y", gt(cref("k"), cref("Modelica", "Constants", "eps"))),
    ]);
    expect(collectEnableConstantNames(m)).toEqual([
      { declaringClass: "Test.C", name: "Modelica.Constants.eps" },
    ]);
  });

  it("takes an inherited field's declaring class from declaredIn, not its direct base", () => {
    const m = model([
      inherited(field("y", cref("Constants", "eps")), "Test.A", "Test.B"),
      field("z", cref("Constants", "eps")),
    ]);
    expect(collectEnableConstantNames(m)).toEqual([
      { declaringClass: "Test.A", name: "Constants.eps" },
      { declaringClass: "Test.C", name: "Constants.eps" },
    ]);
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

  it("walks nested operators, calls and if-branches, deduplicating per declaring class", () => {
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
    expect(
      collectEnableConstantNames(m)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["Lib.flag", "Modelica.Constants.eps"]);
  });
});

describe("resolveEnableConstants", () => {
  it("carries each value OMC reduces, keyed by the dotted name, evaluating it once", async () => {
    const client = fakeClient({ values: { "Modelica.Constants.eps": 1e-15 } });
    const m = model([
      field("k"),
      field("y", gt(cref("k"), cref("Modelica", "Constants", "eps"))),
      field("z", gt(cref("k"), cref("Modelica", "Constants", "eps"))),
    ]);
    const out = await resolveEnableConstants(client, m);
    expect(out.constants).toEqual({ "Modelica.Constants.eps": 1e-15 });
    expect(client.evaluateConstant).toHaveBeenCalledTimes(1);
    expect(client.getClassNames).toHaveBeenCalledTimes(1);
  });

  it("qualifies a relative name in the declaring class's scope and keys it as written", async () => {
    // `Constants.eps` at global scope would miss, or hit an unrelated
    // top-level `Constants`; in `Lib.Blocks.C` it means `Lib.Constants.eps`.
    const client = fakeClient({
      values: { "Lib.Constants.eps": 0.5, "Constants.eps": 99 },
      scopes: { "Lib.Blocks.C|Constants": "Lib.Constants" },
      loaded: ["Lib", "Constants"],
    });
    const m: ParameterModel = {
      className: "Lib.Blocks.C",
      fields: [field("k"), field("y", gt(cref("k"), cref("Constants", "eps")))],
    };
    const out = await resolveEnableConstants(client, m);
    expect(client.qualifyPath).toHaveBeenCalledWith({
      typeName: "Lib.Blocks.C",
      path: "Constants",
    });
    expect(client.evaluateConstant).toHaveBeenCalledWith({
      name: "Lib.Constants.eps",
    });
    expect(out.constants).toEqual({ "Constants.eps": 0.5 });
  });

  it("qualifies an inherited field's name in its base's scope", async () => {
    const client = fakeClient({
      values: { "Modelica.Units.SI.x": 2 },
      scopes: { "Test.Base|SI": "Modelica.Units.SI" },
    });
    const m = model([inherited(field("y", cref("SI", "x")), "Test.Base")]);
    const out = await resolveEnableConstants(client, m);
    expect(client.qualifyPath).toHaveBeenCalledWith({
      typeName: "Test.Base",
      path: "SI",
    });
    expect(out.constants).toEqual({ "SI.x": 2 });
  });

  it("qualifies a grandparent's field in the grandparent's scope, not the direct base's", async () => {
    // C extends B extends A, A declaring the field: `Constants` means
    // `Lib.Constants` in A, while B's scope would bind another package.
    const client = fakeClient({
      values: { "Lib.Constants.eps": 0.5, "Other.Constants.eps": 99 },
      scopes: {
        "Test.A|Constants": "Lib.Constants",
        "Test.B|Constants": "Other.Constants",
      },
      loaded: ["Lib", "Other"],
    });
    const m = model(
      [inherited(field("y", cref("Constants", "eps")), "Test.A", "Test.B")],
      undefined,
      ["Test.A", "Test.B"],
    );
    const out = await resolveEnableConstants(client, m);
    expect(client.qualifyPath).toHaveBeenCalledWith({
      typeName: "Test.A",
      path: "Constants",
    });
    expect(client.qualifyPath).not.toHaveBeenCalledWith({
      typeName: "Test.B",
      path: "Constants",
    });
    expect(out.constants).toEqual({ "Constants.eps": 0.5 });
  });

  it("skips a name that qualifies into a base contributing no field, which an instance may redeclare", async () => {
    // A declares `replaceable package Medium` but no parameter, so no field
    // names A; only `ancestors` shows the path lands inside the chain.
    const client = fakeClient({
      values: { "Test.A.Medium.nXi": 0 },
      scopes: { "Test.C|Medium": "Test.A.Medium" },
    });
    const m = model([field("a", cref("Medium", "nXi"))], undefined, [
      "Test.A",
      "Test.B",
    ]);
    expect(await resolveEnableConstants(client, m)).toBe(m);
    expect(client.evaluateConstant).not.toHaveBeenCalled();
  });

  it("lists the loaded classes before any qualifyPath lookup", async () => {
    const client = fakeClient({ values: { "Lib.flag": true } });
    const m = model([field("a", cref("Lib", "flag"))]);
    await resolveEnableConstants(client, m);
    const [listed] = client.getClassNames.mock.invocationCallOrder;
    const [qualified] = client.qualifyPath.mock.invocationCallOrder;
    if (listed === undefined || qualified === undefined) {
      throw new Error("expected both calls");
    }
    expect(listed).toBeLessThan(qualified);
  });

  it("skips a name that qualifies into the declaring class, which an instance may redeclare", async () => {
    const client = fakeClient({
      values: { "Test.C.Medium.nXi": 0, "Test.C.k0": 1 },
      scopes: { "Test.C|Medium": "Test.C.Medium", "Test.C|C": "Test.C" },
    });
    const m = model([
      field("a", cref("Medium", "nXi")),
      field("b", cref("C", "k0")),
    ]);
    expect(await resolveEnableConstants(client, m)).toBe(m);
    expect(client.evaluateConstant).not.toHaveBeenCalled();
  });

  it("skips a name whose qualification fails", async () => {
    const client = fakeClient({ values: { "Lib.flag": true } });
    client.qualifyPath.mockRejectedValueOnce(new Error("qualifyPath: boom"));
    const m = model([field("a", cref("Lib", "flag"))]);
    expect(await resolveEnableConstants(client, m)).toBe(m);
    expect(client.evaluateConstant).not.toHaveBeenCalled();
  });

  it("drops a written name two declaring classes qualify differently", async () => {
    const client = fakeClient({
      values: { "Lib.A.Constants.eps": 1, "Lib.B.Constants.eps": 2 },
      scopes: {
        "Test.Base|Constants": "Lib.A.Constants",
        "Test.C|Constants": "Lib.B.Constants",
      },
    });
    const m = model([
      inherited(field("y", cref("Constants", "eps")), "Test.Base"),
      field("z", cref("Constants", "eps")),
    ]);
    expect(await resolveEnableConstants(client, m)).toBe(m);
    expect(client.evaluateConstant).not.toHaveBeenCalled();
  });

  it("never evaluates a name whose top-level class is not loaded, which OMC could auto-load", async () => {
    const client = fakeClient({
      values: { "Modelica.Constants.eps": 1e-15, "Unloaded.k": 1 },
      loaded: ["Modelica"],
    });
    const m = model([
      field("a", cref("Modelica", "Constants", "eps")),
      field("b", cref("Unloaded", "k")),
    ]);
    expect((await resolveEnableConstants(client, m)).constants).toEqual({
      "Modelica.Constants.eps": 1e-15,
    });
    expect(client.evaluateConstant).toHaveBeenCalledTimes(1);
    expect(client.evaluateConstant).not.toHaveBeenCalledWith({
      name: "Unloaded.k",
    });
  });

  it("looks nothing up when the loaded classes cannot be listed", async () => {
    const client = fakeClient({ values: { "Lib.flag": true } });
    client.getClassNames.mockRejectedValueOnce(new Error("boom"));
    const m = model([field("a", cref("Lib", "flag"))]);
    expect(await resolveEnableConstants(client, m)).toBe(m);
    expect(client.qualifyPath).not.toHaveBeenCalled();
    expect(client.evaluateConstant).not.toHaveBeenCalled();
  });

  it("leaves out a name that fails to evaluate and keeps the rest", async () => {
    const client = fakeClient({ values: { "Lib.flag": true } });
    const m = model([
      field("a", cref("Lib", "missing")),
      field("d", cref("Lib", "flag")),
    ]);
    expect((await resolveEnableConstants(client, m)).constants).toEqual({
      "Lib.flag": true,
    });
  });

  it("returns the model untouched when nothing needs or yields a value", async () => {
    const client = fakeClient({ values: {} });
    const none = model([field("a", cref("use_x")), field("use_x")]);
    expect(await resolveEnableConstants(client, none)).toBe(none);
    expect(client.qualifyPath).not.toHaveBeenCalled();
    expect(client.getClassNames).not.toHaveBeenCalled();
    expect(client.evaluateConstant).not.toHaveBeenCalled();

    const failing = model([field("a", cref("Lib", "missing"))]);
    expect(await resolveEnableConstants(client, failing)).toBe(failing);
  });
});
