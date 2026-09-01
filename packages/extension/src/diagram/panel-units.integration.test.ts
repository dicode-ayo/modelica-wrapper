/**
 * Live integration test for the parameter-panel unit feature (issue #72).
 *
 * Exercises the real host-side pipeline end to end against OMC:
 *   getModelInstance → SessionUnitCache.buildUnitTable
 *     (client.getDerivedUnits + client.convertUnits) → buildComponentParameterForm
 *
 * This is exactly what `open-diagram.ts`'s `onEditComponent` runs (that
 * handler isn't imported directly because it pulls in `vscode`; the unit-table
 * build + form production is the part under test and is reproduced here).
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

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  OmcClient,
  collectBaseUnits,
  produceParameterModel,
  type ComponentElement,
  type ParameterField,
  type ParameterModel,
  type UnitTable,
} from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import {
  requireComponentParameterForm,
  requireSubComponent,
} from "../../test-support/parameter-forms.js";
import { SessionUnitCache, collectDisplayUnitsByBase } from "./unit-table.js";

function field(model: ParameterModel, name: string): ParameterField {
  const f = model.fields.find((x) => x.name === name);
  if (f === undefined) throw new Error(`expected field '${name}'`);
  return f;
}

/**
 * Build the injected unit table for a component via the session cache, exactly
 * as the host does: produce the model to learn its base units, then resolve
 * them through `SessionUnitCache` (the live `getDerivedUnits` + `convertUnits`).
 */
async function unitTableFor(
  cache: SessionUnitCache,
  component: ComponentElement,
): Promise<UnitTable> {
  const type = component.type;
  if (!type || typeof type === "string") return new Map();
  const model = produceParameterModel(type, {
    component: component.name,
    componentOverrides: component.modifiers,
  });
  return cache.buildUnitTable(
    collectBaseUnits(model),
    collectDisplayUnitsByBase(model),
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
    // displayUnit OMC can convert (s->ms) but does NOT list among
    // getDerivedUnits("s") = {d, h, min}; must still reach the dropdown.
    parameter Modelica.Units.SI.Time tau(displayUnit = "ms") = 0.5;
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
    const inertia = requireSubComponent(instance, "inertia1");
    const cache = new SessionUnitCache(client);
    const table = await unitTableFor(cache, inertia);
    const form = requireComponentParameterForm(inertia, table);

    const J = field(form.model, "J");
    expect(J.unit).toBe("kg.m2");
    // kg.m2 has no derived units → a single identity option → static suffix.
    expect(J.unitOptions.map((o) => o.unit)).toEqual(["kg.m2"]);
  }, 60_000);

  it("builds a rad/deg dropdown with real conversion factors", async () => {
    const { instance } = await client.getModelInstance({ typeName: host });
    const comp = requireSubComponent(instance, "comp1");
    const cache = new SessionUnitCache(client);
    const table = await unitTableFor(cache, comp);
    const form = requireComponentParameterForm(comp, table);

    const phi = field(form.model, "phi");
    expect(phi.unit).toBe("rad");
    expect(phi.displayUnit).toBe("deg");

    const opts = phi.unitOptions;
    const units = opts.map((o) => o.unit);
    expect(units).toContain("rad");
    expect(units).toContain("deg");
    expect(units.length).toBeGreaterThanOrEqual(2);

    const deg = opts.find((o) => o.unit === "deg");
    if (deg === undefined) throw new Error("expected a 'deg' unit option");
    // convertUnits("rad","deg") = (true, 0.0174…, 0). Shown value =
    // (1.5708 - 0) / 0.0174… ≈ 90 deg.
    expect(deg.scaleFactor).toBeCloseTo(0.017453292519943295, 9);
    expect(deg.offset).toBeCloseTo(0, 9);
    const shownDeg = (1.5707963267948966 - deg.offset) / deg.scaleFactor;
    expect(shownDeg).toBeCloseTo(90, 6);
  }, 60_000);

  it("keeps a displayUnit OMC can convert but doesn't list as derived (s→ms)", async () => {
    // Regression guard: the pre-refactor enrichUnitOptions pushed the field's
    // displayUnit into the option list unconditionally; the session-cached
    // table is keyed by base unit and built from getDerivedUnits, which for "s"
    // returns {d, h, min} — NOT "ms". Without folding the declared displayUnit
    // back in, the dropdown would silently drop "ms" and fall back to seconds.
    const { instance } = await client.getModelInstance({ typeName: host });
    const comp = requireSubComponent(instance, "comp1");
    const cache = new SessionUnitCache(client);
    const table = await unitTableFor(cache, comp);
    const form = requireComponentParameterForm(comp, table);

    const tau = field(form.model, "tau");
    expect(tau.unit).toBe("s");
    expect(tau.displayUnit).toBe("ms");

    const opts = tau.unitOptions;
    expect(opts.map((o) => o.unit)).toContain("ms");
    const ms = opts.find((o) => o.unit === "ms");
    if (ms === undefined) throw new Error("expected an 'ms' unit option");
    // convertUnits("s","ms") = (true, 0.001, 0). Shown = (0.5 - 0) / 0.001 = 500.
    expect(ms.scaleFactor).toBeCloseTo(0.001, 9);
    expect((0.5 - ms.offset) / ms.scaleFactor).toBeCloseTo(500, 6);
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
    const comp = requireSubComponent(instance, "comp1");
    const cache = new SessionUnitCache(client);
    const table = await unitTableFor(cache, comp);
    const form = requireComponentParameterForm(comp, table);

    const phi = field(form.model, "phi");
    const opts = phi.unitOptions;
    const deg = opts.find((o) => o.unit === "deg");
    if (deg === undefined) throw new Error("expected a 'deg' unit option");

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
