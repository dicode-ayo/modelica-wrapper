/**
 * End-to-end gate for the two ways an entity edit used to lose data attached
 * to the entity: a move dropping its placement `origin`, and a delete leaving
 * the `connect()` equations that named it.
 *
 * The move failure is in the annotation text OMC writes, so only a real OMC
 * shows it. For the delete, the layout-op guard lives in diagram-ui's unit
 * tests; what needs OMC here is that the resulting batch leaves a class that
 * still loads — the old behaviour reported every edit applied and left an
 * orphan `connect()` behind.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { applyEdits } from "./apply-edits.js";
import { diffLayouts } from "./diff-layout.js";
import { fetchDiagramLayout } from "./open-diagram.js";

describeIf("entity edits against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwEntity_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.T`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `within ;
package ${pkg}
  model T
    Modelica.Blocks.Interfaces.RealInput u annotation(
      Placement(transformation(origin = {0, -120}, extent = {{20, -20}, {-20, 20}}, rotation = 270)));
    Modelica.Blocks.Math.Gain g annotation(
      Placement(transformation(extent = {{-10, -10}, {10, 10}})));
  equation
    connect(u, g.u) annotation(Line(points = {{0, -120}, {-12, 0}}));
    annotation(Diagram(coordinateSystem(extent = {{-200, -200}, {200, 200}})));
  end T;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
  });

  afterEach(async () => {
    await client.deleteClass({ typeName: pkg });
    await client.close();
  });

  it("keeps a placement origin across a move", async () => {
    const before = await fetchDiagramLayout(client, cls);
    const u = before.connectors.u;
    expect(u?.placement.origin).toEqual([0, -120]);

    const moved = structuredClone(before) as typeof before;
    const target = moved.connectors.u;
    if (!target) throw new Error("expected connector u");
    target.placement = {
      ...target.placement,
      extent: [
        [25, -15],
        [-15, 25],
      ],
    };

    const result = await applyEdits(client, cls, diffLayouts(before, moved));
    expect(result.failed).toEqual([]);

    const { contents } = await client.listFile({ typeName: cls });
    // Without the origin the connector sits 120 units away, in the middle.
    expect(contents).toContain("origin = {0, -120}");
    expect(contents).toContain("extent = {{25, -15}, {-15, 25}}");
  });

  it("writes a delete batch that leaves a class OMC can still load", async () => {
    // The guard for `applyDelete` pruning attached wires is a diagram-ui unit
    // test — driving it from here would pull the webview bundle into a Node
    // test. What only a real OMC can show is the other half: a batch that
    // deletes declarations *and* their connections leaves a loadable class,
    // where one that deletes declarations alone reports every edit applied and
    // leaves an orphan `connect()` behind.
    const before = await fetchDiagramLayout(client, cls);
    const result = await applyEdits(
      client,
      cls,
      diffLayouts(before, {
        ...before,
        components: {},
        connectors: {},
        connections: [],
      }),
    );
    expect(result.failed).toEqual([]);

    const { contents } = await client.listFile({ typeName: cls });
    expect(contents).not.toContain("connect(");
    expect(contents).not.toContain("RealInput");

    const reloaded = await client.loadString({
      data: contents,
      filename: `<recheck:${pkg}>`,
    });
    expect(reloaded.success).toBe(true);
    const instance = await client.getModelInstance({
      typeName: cls,
      prettyPrint: false,
    });
    expect(instance.instance).toBeTruthy();
  });
});
