/**
 * Regression: which `Placement(...)` annotation form does OMC's
 * `addComponent` accept?
 *
 * The wrapper's main integration test only sends an empty
 * `Placement()`, leaving complex annotations uncovered. This file
 * pins the **expression form** with a `transformation=` keyword as
 * the supported shape, and explicitly documents the one positional
 * form that OMC 1.26.x rejects.
 *
 * History: the extension's `placementAt()` helper originally emitted
 * `Placement(visible=true, transformation(...))` (modification /
 * positional form). OMC's parser surfaced that as a confusing
 * "Parser error: Unexpected token near: addComponent (IDENT)" —
 * really a parse failure inside the annotation, not on the function
 * name itself. The keyword form `transformation=transformation(...)`
 * fixes it; this test guards against regression.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { disposeFixture, loadFixture, type Fixture } from "./fixtures.js";

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

describeIf("addComponent: Placement annotation forms (real OMC)", () => {
  let client: OmcClient;
  let fixture: Fixture;
  const componentClass = "Modelica.Blocks.Math.Gain";

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    // Modelica needs to be loaded for `Modelica.Blocks.Math.Gain` to
    // resolve. `loadModel` is idempotent — no-op if already loaded.
    const loaded = await client.loadModel({ typeName: "Modelica" });
    if (!loaded.success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`could not load Modelica: ${errorString}`);
    }
    fixture = await loadFixture(client);
  });

  afterEach(async () => {
    await disposeFixture(client, fixture);
    await client.close();
  });

  it("accepts the absolute-extent Placement that placementAt() emits", async () => {
    // This is the exact shape produced by
    // `packages/extension/src/diagram/open-diagram.ts:placementAt`.
    // Same encoding as `diff-layout.ts:placementAnnotation()` so the
    // add/drag round-trip stays consistent. If you change either
    // helper, update this string too.
    const annotation =
      "Placement(transformation(extent={{0, 10}, {20, 30}}))";

    await client.getErrorString();
    const { success, diagnostic } = await client.addComponent({
      componentName: "gain1",
      componentClass,
      intoTypeName: fixture.modelClass,
      annotation,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(
        `addComponent failed unexpectedly. diagnostic=${diagnostic ?? "(none)"} errorString=${errorString}`,
      );
    }
    expect(success).toBe(true);
    expect(diagnostic).toBeUndefined();
  });

  it("also accepts the keyword-form Placement with visible=true", async () => {
    // Documents the secondary safe form: if anything ever needs
    // `visible=true` together with origin/transformation, the
    // keyword shape is the one OMC's parser accepts.
    const annotation =
      "Placement(visible=true, transformation=transformation(" +
      "origin={10, 20}, extent={{-10, -10}, {10, 10}}))";

    await client.getErrorString();
    const { success } = await client.addComponent({
      componentName: "gain2",
      componentClass,
      intoTypeName: fixture.modelClass,
      annotation,
    });
    expect(success).toBe(true);
  });

  it("rejects the positional form when combined with visible=true (the bug)", async () => {
    // Pins the OMC quirk that motivated the keyword-form fix. If a
    // future OMC release stops rejecting this shape, this test will
    // start failing and we can simplify `placementAt()` back.
    const annotation =
      "Placement(visible=true, transformation(" +
      "origin={10, 20}, extent={{-10, -10}, {10, 10}}))";

    await client.getErrorString();
    const { success, diagnostic } = await client.addComponent({
      componentName: "gain3",
      componentClass,
      intoTypeName: fixture.modelClass,
      annotation,
    });
    expect(success).toBe(false);
    expect(diagnostic ?? "").toContain("Parser error");
  });
});
