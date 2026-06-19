/**
 * End-to-end gate for the graphics edit pipeline (#186): drives `applyEdits`
 * — not `writeClassGraphics` directly — against a real OMC install, proving the
 * assembled path `LayoutEdit → invoke("writeClassGraphics") → OMC` persists and
 * that the snapshot rollback covers a graphics failure.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OmcClient,
  annotationGraphics,
  type EllipseShape,
  type Value,
} from "@dicode/omc-client";

import { applyEdits } from "./apply-edits.js";

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

function graphicsNames(annotation: Value): string[] {
  return annotationGraphics(annotation).map((g) =>
    g.kind === "call" ? g.name : g.kind,
  );
}

const ellipse: EllipseShape = {
  kind: "ellipse",
  extent: [
    [1, 1],
    [2, 2],
  ],
  lineColor: [10, 20, 30],
};

describeIf("applyEdits graphics against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwApply_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `package ${pkg}
  model Sample
    annotation(Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={Rectangle(extent={{-40,-40},{40,40}}, lineColor={0,0,255})}));
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
  });

  afterEach(async () => {
    await client.deleteClass({ typeName: pkg });
    await client.close();
  });

  it("persists a graphicsAdded edit through the pipeline", async () => {
    const result = await applyEdits(client, cls, [
      { kind: "graphicsAdded", layer: "icon", shape: ellipse },
    ]);
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(after.annotation)).toEqual(["Rectangle", "Ellipse"]);
  });

  it("persists a graphicsDeleted edit through the pipeline", async () => {
    const result = await applyEdits(client, cls, [
      { kind: "graphicsDeleted", layer: "icon", index: 0 },
    ]);
    expect(result.applied).toBe(1);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(after.annotation)).toEqual([]);
  });

  it("rolls back a partially-applied graphics batch when snapshot is on", async () => {
    // The modify (ordered first) succeeds and rewrites the Rectangle to an
    // Ellipse; the out-of-range delete then fails, so the snapshot restores
    // the original Rectangle — proving the partial change was undone.
    const result = await applyEdits(
      client,
      cls,
      [
        { kind: "graphicsModified", layer: "icon", index: 0, shape: ellipse },
        { kind: "graphicsDeleted", layer: "icon", index: 9 },
      ],
      undefined,
      { snapshot: true },
    );
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.rolledBack).toBe(true);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(after.annotation)).toEqual(["Rectangle"]);
  });
});
