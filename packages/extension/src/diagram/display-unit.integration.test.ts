/**
 * Live integration test for the host-side unit annotation
 * (issue #28/#68 — convert; issue #71 — generalize to plain units).
 *
 * Exercises the real host-side pipeline end to end against OMC:
 *   getModelInstance → produceDiagramLayout → applyDisplayUnits(client.convertUnits)
 *
 * This is exactly what `open-diagram.ts` `fetchLayout` runs (that function
 * isn't imported directly because it pulls in `vscode`; the annotation stage
 * — `applyDisplayUnits` + `client.convertUnits` — is the part under test and
 * is reproduced here verbatim).
 *
 * Fixture shape note: `DiagramLayout.classes` is the catalog of *sub-component
 * types*, not the host's own class — the producer only adds a `ClassDef` when
 * a `ComponentInstance` references that type. `buildSubstitutions` reads
 * `classes[component.classRef].parameters[name].value` for `%paramName`, so
 * the parameters must live on a sub-component's type (`Comp`) to be exercised
 * by both the substitution path and `applyDisplayUnits`.
 *
 * Acceptance:
 *   - issue #28: `Angle a(displayUnit="deg") = 1.5707963267948966` renders
 *     its `%a` label as ~90 (deg), not 1.57 (the source-unit rad value);
 *   - issue #71: `Inertia J = 1` (unit `kg.m2`, no displayUnit) renders its
 *     `%J` label with the bare unit appended → `"1 kg.m2"`.
 *
 * Auto-skips when `omc` isn't on PATH.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient, diagram } from "@dicode/omc-client";

import { applyDisplayUnits } from "./display-unit.js";

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

describeIf("displayUnit conversion (live OMC) (#28)", () => {
  let client: OmcClient;
  let pkg: string;
  let host: string;
  let comp: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    pkg = `MwDisplayUnit_${randomBytes(4).toString("hex")}`;
    host = `${pkg}.Host`;
    comp = `${pkg}.Comp`;
    const { success } = await client.loadString({
      data: `package ${pkg}
  model Comp
    parameter Modelica.Units.SI.Angle a(displayUnit = "deg") = 1.5707963267948966;
    parameter Modelica.Units.SI.Angle b = 3.141592653589793;
    parameter Modelica.Units.SI.Inertia J = 1;
    annotation(Icon(graphics={Text(extent={{-10, -10}, {10, 10}}, textString = "J=%J")}));
  end Comp;
  model Host
    Comp comp1 annotation(Placement(transformation(extent={{-10, -10}, {10, 10}})));
  end Host;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`fixture load failed: ${errorString}`);
    }
  }, 60_000);

  afterEach(async () => {
    try {
      await client.deleteClass({ typeName: pkg });
    } catch {
      // OMC closing / already gone — nothing to do.
    }
    await client.close();
  });

  it("rewrites the Angle param value from ~1.57 rad to ~90 deg", async () => {
    const { instance } = await client.getModelInstance({ typeName: host });
    const layout = diagram.produceDiagramLayout(instance, "diagram");

    // Sanity: the producer surfaced unit + displayUnit on Comp's `a`, and
    // the source value is still the rad number (~1.57).
    const before = layout.classes[comp]!.parameters.a!;
    expect(before.unit).toBe("rad");
    expect(before.displayUnit).toBe("deg");
    expect(Number.parseFloat(before.value)).toBeCloseTo(1.5708, 3);

    // The exact host-side stage from open-diagram.ts fetchLayout.
    await applyDisplayUnits(layout, (s1, s2) =>
      client.convertUnits({ s1, s2 }),
    );

    const after = layout.classes[comp]!.parameters.a!;
    // The rewritten display value parses to ~90 (string is "90 deg").
    expect(Number.parseFloat(after.value)).toBeCloseTo(90, 1);
    expect(after.value).toContain("deg");
  });

  it("appends the bare unit for a no-displayUnit param (#71)", async () => {
    const { instance } = await client.getModelInstance({ typeName: host });
    const layout = diagram.produceDiagramLayout(instance, "diagram");

    await applyDisplayUnits(layout, (s1, s2) =>
      client.convertUnits({ s1, s2 }),
    );

    // `b` has no displayUnit modifier — its rad value is kept (no conversion)
    // and the declared unit is appended verbatim → "3.14… rad".
    const b = layout.classes[comp]!.parameters.b!;
    expect(Number.parseFloat(b.value)).toBeCloseTo(3.14159, 4);
    expect(b.value).not.toContain("deg");
    expect(b.value).toMatch(/\srad$/);
  });

  it("renders Inertia J=1 with its kg.m2 unit appended (#71)", async () => {
    const { instance } = await client.getModelInstance({ typeName: host });
    const layout = diagram.produceDiagramLayout(instance, "diagram");

    // Sanity: the producer surfaced unit kg.m2 with no displayUnit.
    const before = layout.classes[comp]!.parameters.J!;
    expect(before.unit).toBe("kg.m2");
    expect(before.displayUnit ?? "").toBe("");

    await applyDisplayUnits(layout, (s1, s2) =>
      client.convertUnits({ s1, s2 }),
    );

    const after = layout.classes[comp]!.parameters.J!;
    expect(after.value).toBe("1 kg.m2");
  });
});
