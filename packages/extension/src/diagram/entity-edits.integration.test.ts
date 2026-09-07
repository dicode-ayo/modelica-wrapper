/**
 * End-to-end gate for three ways an entity edit can lose data attached to the
 * entity: a move dropping its placement `origin`, a move dropping the
 * placement keyword it did not touch, and a delete leaving the `connect()`
 * equations that named it.
 *
 * Both move failures are in the annotation text OMC writes, and the second is
 * in which OMC call carries it, so only a real OMC shows either — a mocked
 * client reports success for a call OMC would reject. For the delete, the layout-op guard lives in diagram-ui's unit
 * tests; what needs OMC here is that the batch leaves a class that still
 * loads — OMC accepts an orphan `connect()` and reports every edit applied.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, expect, it } from "vitest";

import type * as vscode from "vscode";

import { OmcClient } from "@dicode/omc-client";

import { sourceUriFor } from "../source-provider.js";

import { describeIf } from "../../test-support/integration-gate.js";
import { applyEdits } from "./apply-edits.js";
import { diffLayouts } from "./diff-layout.js";
import { reloadBufferIntoOmc } from "./buffer-sync.js";
import {
  applyDiagramEdits,
  fetchDiagramLayout,
  fetchIconLayout,
} from "./open-diagram.js";

describeIf("entity edits against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    pkg = `MwEntity_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.T`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `within ;
package ${pkg}
  model T
    Modelica.Blocks.Interfaces.RealInput u annotation(
      Placement(transformation(origin = {0, -120}, extent = {{20, -20}, {-20, 20}}, rotation = 270)));
    Modelica.Blocks.Interfaces.RealInput w annotation(
      Placement(transformation(extent = {{-140, -20}, {-100, 20}}),
                iconTransformation(extent = {{-60, 60}, {-40, 80}})));
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

    const moved = structuredClone(before);
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

  it("keeps both placement keywords across a move", async () => {
    const before = await fetchDiagramLayout(client, cls);
    const w = before.connectors.w;
    expect(w?.iconPlacement?.extent).toEqual([
      [-60, 60],
      [-40, 80],
    ]);

    const moved = structuredClone(before);
    const target = moved.connectors.w;
    if (!target) throw new Error("expected connector w");
    target.placement = {
      ...target.placement,
      extent: [
        [-130, -10],
        [-90, 30],
      ],
    };

    // The editor's own entry point, so the snapshot/rollback path a failed
    // edit would take is part of what this exercises.
    const result = await applyDiagramEdits(client, cls, before, moved);
    expect(result?.failed).toEqual([]);
    expect(result?.rolledBack).toBe(false);

    const { contents } = await client.listFile({ typeName: cls });
    expect(contents).toContain("extent = {{-130, -10}, {-90, 30}}");
    // The keyword the drag did not touch has to survive the write.
    expect(contents).toContain(
      "iconTransformation(extent = {{-60, 60}, {-40, 80}})",
    );
  });

  it("shows the host's connectors in the icon editor's layout", async () => {
    const layout = await fetchIconLayout(client, cls);

    expect(Object.keys(layout.connectors).sort()).toEqual(["u", "w"]);
    // The icon view places a dual-keyword connector at its `iconTransformation`.
    expect(layout.connectors.w?.placement.extent).toEqual([
      [-60, 60],
      [-40, 80],
    ]);
  });

  it("puts a moved connector back when the buffer is reverted", async () => {
    // What a VSCode undo does: the shadow buffer returns to the pre-edit source
    // and the controller loads it back over the class. Reverting the text is
    // only half an undo — the class has to follow, or the diagram re-renders
    // from OMC still holding the move.
    const { contents: before } = await client.listFile({ typeName: cls });

    const layout = await fetchDiagramLayout(client, cls);
    const moved = structuredClone(layout);
    const target = moved.connectors.w;
    if (!target) throw new Error("expected connector w");
    target.placement = {
      ...target.placement,
      extent: [
        [-130, -10],
        [-90, 30],
      ],
    };
    const applied = await applyDiagramEdits(client, cls, layout, moved);
    expect(applied?.failed).toEqual([]);

    const reload = await reloadBufferIntoOmc(
      client,
      { getText: () => before, uri: sourceUriFor(cls) } as vscode.TextDocument,
      cls,
    );
    expect(reload).toEqual({ ok: true });

    const restored = await fetchDiagramLayout(client, cls);
    expect(restored.connectors.w?.placement.extent).toEqual([
      [-140, -20],
      [-100, 20],
    ]);
    expect(restored.connectors.w?.iconPlacement?.extent).toEqual([
      [-60, 60],
      [-40, 80],
    ]);
  });

  it("writes a delete batch that leaves a class OMC can still load", async () => {
    // The guard for `applyDelete` pruning attached wires is a diagram-ui unit
    // test — driving it from here would reach into the webview package. What
    // only OMC can show is that a batch deleting declarations *and* their
    // connections leaves a loadable class.
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
