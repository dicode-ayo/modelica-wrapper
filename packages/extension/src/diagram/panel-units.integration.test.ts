/**
 * Live integration test for the parameter-panel unit feature (issue #72).
 *
 * Exercises the real host-side pipeline end to end against OMC:
 *   getModelInstance → buildComponentParameterForm → enrichUnitOptions
 *     (client.getDerivedUnits + client.convertUnits)
 *
 * This is exactly what `open-diagram.ts`'s `onEditComponent` runs (that
 * handler isn't imported directly because it pulls in `vscode`; the form
 * build + unit enrichment is the part under test and is reproduced here).
 *
 * Acceptance (issue #72):
 *   - A component with a `kg.m2` parameter (`Inertia.J`) → the field's
 *     `x-modelica-unit` is `"kg.m2"` and it gets a single-entry option list
 *     (→ static suffix on the form).
 *   - A `rad` angle with `displayUnit="deg"` → the field carries
 *     `x-modelica-unit="rad"`, `x-modelica-display-unit="deg"`, and a ≥2
 *     option list with real conversion factors (→ dropdown).
 *
 * Auto-skips when `omc` isn't on PATH; honours `OMC_INTEGRATION=0/1`.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@modelica-wrapper/omc-client";

import {
  buildComponentParameterForm,
  findSubComponent,
} from "./component-parameter-form.js";
import { enrichUnitOptions } from "./unit-options.js";

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

/** Enrich a freshly-built form schema with the live client, as the host does. */
async function enrich(client: OmcClient, schema: Parameters<typeof enrichUnitOptions>[0]) {
  return enrichUnitOptions(
    schema,
    async (unit) => (await client.getDerivedUnits({ baseUnit: unit })).derivedUnits,
    (s1, s2) => client.convertUnits({ s1, s2 }),
  );
}

describeIf("parameter-panel units (live OMC) (#72)", () => {
  let client: OmcClient;
  let pkg: string;
  let host: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    pkg = `MwPanelUnits_${randomBytes(4).toString("hex")}`;
    host = `${pkg}.Host`;
    // Host pulls in the real MSL Inertia (kg.m2 on J) plus a local angle
    // param with a displayUnit so we exercise both the suffix and dropdown
    // paths without depending on a specific MSL model's start attributes.
    const { success } = await client.loadString({
      data: `package ${pkg}
  model Comp
    parameter Modelica.Units.SI.Angle phi(displayUnit = "deg") = 1.5707963267948966;
  end Comp;
  model Host
    Modelica.Mechanics.Rotational.Components.Inertia inertia1
      annotation(Placement(transformation(extent={{-10, -10}, {10, 10}})));
    Comp comp1
      annotation(Placement(transformation(extent={{20, -10}, {40, 10}})));
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

  it("surfaces J's unit as kg.m2 (the screenshot's static-suffix case)", async () => {
    const { instance } = await client.getModelInstance({ typeName: host });
    const inertia = findSubComponent(instance, "inertia1")!;
    const form = buildComponentParameterForm(inertia)!;

    const J = (form.schema.properties ?? {}).J as Record<string, unknown>;
    expect(J["x-modelica-unit"]).toBe("kg.m2");

    await enrich(client, form.schema);
    const opts = J["x-modelica-unit-options"] as Array<{ unit: string }>;
    // kg.m2 has no derived units → a single identity option → static suffix.
    expect(opts.map((o) => o.unit)).toEqual(["kg.m2"]);
  }, 60_000);

  it("builds a rad/deg dropdown with real conversion factors", async () => {
    const { instance } = await client.getModelInstance({ typeName: host });
    const comp = findSubComponent(instance, "comp1")!;
    const form = buildComponentParameterForm(comp)!;

    const phi = (form.schema.properties ?? {}).phi as Record<string, unknown>;
    expect(phi["x-modelica-unit"]).toBe("rad");
    expect(phi["x-modelica-display-unit"]).toBe("deg");

    await enrich(client, form.schema);
    const opts = phi["x-modelica-unit-options"] as Array<{
      unit: string;
      scaleFactor: number;
      offset: number;
    }>;
    const units = opts.map((o) => o.unit);
    expect(units).toContain("rad");
    expect(units).toContain("deg");
    expect(units.length).toBeGreaterThanOrEqual(2);

    const deg = opts.find((o) => o.unit === "deg")!;
    // convertUnits("rad","deg") = (true, 0.0174…, 0). Shown value =
    // (1.5708 - 0) / 0.0174… ≈ 90 deg.
    expect(deg.scaleFactor).toBeCloseTo(0.017453292519943295, 9);
    expect(deg.offset).toBeCloseTo(0, 9);
    const shownDeg = (1.5707963267948966 - deg.offset) / deg.scaleFactor;
    expect(shownDeg).toBeCloseTo(90, 6);
  }, 60_000);

  it("submit round-trips deg→rad with REAL factors (the corruption blocker)", async () => {
    // End-to-end guard for PR #74's value-corruption bug: opening the rad
    // param (shown as 90 deg) and submitting must yield the BASE rad value,
    // not the deg number. Uses the live `convertUnits` factors the host
    // ships, then replays the form's submit-side back-conversion math (the
    // inverse leg the component runs in `backConvertToBaseUnit`):
    //   shown = (source - offset) / scaleFactor   (open / display)
    //   source = shown * scaleFactor + offset      (submit / back-convert)
    const baseRad = 1.5707963267948966;
    const { instance } = await client.getModelInstance({ typeName: host });
    const comp = findSubComponent(instance, "comp1")!;
    const form = buildComponentParameterForm(comp)!;
    await enrich(client, form.schema);

    const phi = (form.schema.properties ?? {}).phi as Record<string, unknown>;
    const opts = phi["x-modelica-unit-options"] as Array<{
      unit: string;
      scaleFactor: number;
      offset: number;
    }>;
    const deg = opts.find((o) => o.unit === "deg")!;

    // (a) open shows 90 deg …
    const shownDeg = (baseRad - deg.offset) / deg.scaleFactor;
    expect(shownDeg).toBeCloseTo(90, 6);

    // … (c) edit to 180 deg → submit → base rad must be π.
    const editedBaseRad = 180 * deg.scaleFactor + deg.offset;
    expect(editedBaseRad).toBeCloseTo(Math.PI, 6);

    // (a) submit UNCHANGED → back-converted base must match the original
    // base initial to within round-trip tolerance (the form then SNAPS to
    // the exact initial, so the host writes nothing).
    const roundTripped = shownDeg * deg.scaleFactor + deg.offset;
    expect(roundTripped).toBeCloseTo(baseRad, 9);
  }, 60_000);
});
