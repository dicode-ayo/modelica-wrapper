/**
 * Live integration test for the producer's conditional-component /
 * port gating.
 *
 * Spins up OMC, loads a tiny package with a conditional sub-component
 * (`Real x if use_x;`) plus a conditional connector
 * (`RealInput uIn if use_in;`), then calls
 * `getInstantiatedParametersAndValues` to confirm OMC's reduction is
 * what we expect, and finally exercises `produceDiagramLayout(... ,
 * resolvedParameters)` to assert the gated elements drop out of the
 * layout while their `use_*` predicates are `false`.
 *
 * Auto-skips when `omc` isn't on PATH.
 */

import { execSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import {
  parseInstantiatedParameters,
  produceDiagramLayout,
} from "../src/api/diagram/index.js";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

describeIf("produceDiagramLayout: conditional gating (live OMC)", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeAll(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await client.loadModel({ typeName: "Modelica" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwCond_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    // `Real x if use_x;` is the textbook conditional-component shape;
    // `RealInput uIn if use_in` is the same for a connector port. Both
    // get a single Boolean cref as the predicate so the
    // expression-evaluator path is exercised end-to-end without
    // arithmetic.
    const data = `package ${pkg}
  model Sample
    parameter Boolean use_x = true;
    parameter Boolean use_y = true;
    parameter Boolean use_in = true;
    parameter Boolean use_out = true;
    Modelica.Blocks.Interfaces.RealInput uIn if use_in
      annotation(Placement(transformation(extent={{-110,-10},{-90,10}})));
    Modelica.Blocks.Interfaces.RealOutput yOut if use_out
      annotation(Placement(transformation(extent={{90,-10},{110,10}})));
    Modelica.Blocks.Math.Gain x(k=1.0) if use_x
      annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
    Modelica.Blocks.Math.Gain y(k=2.0) if use_y
      annotation(Placement(transformation(extent={{30,-10},{50,10}})));
  end Sample;
end ${pkg};
`;
    const { success } = await client.loadString({
      data,
      filename: `<conditional-fixture:${pkg}>`,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadString failed: ${errorString}`);
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await client.deleteClass({ typeName: pkg });
    } catch {
      // best-effort cleanup
    }
    await client.close();
  });

  it("getInstantiatedParametersAndValues reports the four Boolean predicates", async () => {
    const { result } = await client.getInstantiatedParametersAndValues({
      typeName: cls,
    });
    const map = parseInstantiatedParameters(result);
    expect(map.use_x).toBe("true");
    expect(map.use_y).toBe("true");
    expect(map.use_in).toBe("true");
    expect(map.use_out).toBe("true");
  });

  it("with all predicates true: every element is visible in the layout", async () => {
    const { instance } = await client.getModelInstance({ typeName: cls });
    const { result } = await client.getInstantiatedParametersAndValues({
      typeName: cls,
    });
    const layout = produceDiagramLayout(
      instance,
      "diagram",
      parseInstantiatedParameters(result),
    );
    expect(Object.keys(layout.components).sort()).toEqual(["x", "y"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["uIn", "yOut"]);
  });

  it("flipping use_y / use_out to false elides the corresponding elements", async () => {
    // Mutate the model in-place; the resolved-params map we pass to
    // the producer reflects the OMC instantiation AFTER the toggle,
    // not the source defaults.
    await client.setComponentModifierValue({
      typeName: cls,
      modifier: "use_y",
      expr: "false",
    });
    await client.setComponentModifierValue({
      typeName: cls,
      modifier: "use_out",
      expr: "false",
    });
    try {
      const { instance } = await client.getModelInstance({ typeName: cls });
      const { result } = await client.getInstantiatedParametersAndValues({
        typeName: cls,
      });
      const map = parseInstantiatedParameters(result);
      expect(map.use_y).toBe("false");
      expect(map.use_out).toBe("false");

      const layout = produceDiagramLayout(instance, "diagram", map);
      expect(Object.keys(layout.components).sort()).toEqual(["x"]);
      expect(Object.keys(layout.connectors).sort()).toEqual(["uIn"]);
      // resolvedParameters is echoed onto the layout for the renderer.
      expect(layout.resolvedParameters?.use_y).toBe("false");
    } finally {
      // Restore so the next test sees the original ramp.
      await client.setComponentModifierValue({
        typeName: cls,
        modifier: "use_y",
        expr: "true",
      });
      await client.setComponentModifierValue({
        typeName: cls,
        modifier: "use_out",
        expr: "true",
      });
    }
  });

  it("without resolvedParameters the producer keeps everything visible (pre-feature default)", async () => {
    const { instance } = await client.getModelInstance({ typeName: cls });
    // Even if we mutate use_x to false in OMC, omitting the params
    // argument to `produceDiagramLayout` means the gating is skipped
    // — preserves existing renderer behaviour for callers that haven't
    // adopted the new third parameter yet.
    await client.setComponentModifierValue({
      typeName: cls,
      modifier: "use_x",
      expr: "false",
    });
    try {
      const layout = produceDiagramLayout(instance, "diagram");
      expect(Object.keys(layout.components).sort()).toEqual(["x", "y"]);
      expect(layout.resolvedParameters).toBeUndefined();
    } finally {
      await client.setComponentModifierValue({
        typeName: cls,
        modifier: "use_x",
        expr: "true",
      });
    }
  });
});
