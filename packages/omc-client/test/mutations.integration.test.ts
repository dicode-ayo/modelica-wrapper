/**
 * Integration tests for OMC mutations against a real OMC install.
 *
 * Each test loads a fresh throwaway package via `loadFixture()`, mutates it,
 * verifies, and disposes. Fixtures are name-randomized so parallel test
 * runs don't clash.
 *
 * Auto-runs whenever `omc` is on PATH (same gating as integration.test.ts).
 *
 * Tests excluded from this file (wrappers exist but are NOT verified against
 * the pinned OMC version 1.26.1 — see docs/coverage.md for rationale):
 *
 *   createClass, createSubClass    — undocumented in public scripting API; OMC
 *                                     1.26.1 returns "Class X not found".
 *   copyClass                      — documented but OMC 1.26.1 reports the
 *                                     same "not found" symptom; may have
 *                                     moved to an internal namespace.
 *   renameClass / deleteClass      — work but require create* for setup.
 *   moveClass / moveClassToTop /   — same; require create* for setup.
 *     moveClassToBottom
 *   save                           — OMEdit-deprecated; we use Option B
 *                                     persistence (listFile + own writer).
 *   setComponentProperties         — OMC 1.26.1 expects a different argument
 *                                     shape than the wrapper sends; needs an
 *                                     OMC-version-specific dispatch.
 *   updateConnection               — fails with "not found" on 1.26.1.
 *   addTransition / deleteTransition — state-machine specific; would need a
 *                                     dedicated state-machine fixture.
 *   removeComponentModifiers       — same "not found" pattern.
 */

import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import {
  disposeFixture,
  loadFixture,
  loadParameterFixture,
  type Fixture,
} from "./fixtures.js";

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

describeIf("OmcClient mutations against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
  });

  afterEach(async () => {
    await client.close();
  });

  // === Lifecycle: source-file + load + diff ===

  describe("lifecycle", () => {
    let fixture: Fixture;

    beforeEach(async () => {
      fixture = await loadFixture(client);
    });

    afterEach(async () => {
      await disposeFixture(client, fixture);
    });

    it("getSourceFile / setSourceFile round-trip a path", async () => {
      const before = await client.getSourceFile({
        typeName: fixture.modelClass,
      });
      expect(typeof before.fileName).toBe("string");

      const newPath = `/tmp/mw-test-${fixture.packageName}.mo`;
      const set = await client.setSourceFile({
        typeName: fixture.modelClass,
        fileName: newPath,
      });
      expect(set.success).toBe(true);

      const after = await client.getSourceFile({
        typeName: fixture.modelClass,
      });
      expect(after.fileName).toBe(newPath);
    });

    it("loadFile + parseFile work on a real .mo file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "mw-test-"));
      try {
        const filename = join(dir, "TestPkg.mo");
        await writeFile(
          filename,
          `package TestPkg
  model M
    Real x;
  end M;
end TestPkg;
`,
          "utf8",
        );

        const parsed = await client.parseFile({ fileName: filename });
        expect(parsed.classNames).toContain("TestPkg");

        const loaded = await client.loadFile({ fileName: filename });
        expect(loaded.success).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("diffModelicaFileListings returns a diff string", async () => {
      const before = "model M Real x; end M;";
      const after = "model M Real x; Real y; end M;";
      const { diff } = await client.diffModelicaFileListings({
        before,
        after,
        kind: "plain",
      });
      expect(typeof diff).toBe("string");
      expect(diff.length).toBeGreaterThan(0);
    });

    it("renameClass renames a fixture's class and returns the new path(s)", async () => {
      const newName = `${fixture.packageName}_Renamed`;
      const { result } = await client.renameClass({
        typeName: fixture.modelClass,
        newName,
      });
      expect(Array.isArray(result)).toBe(true);
      // After rename the original FQN should no longer resolve.
      const { exists } = await client.existClass({
        typeName: fixture.modelClass,
      });
      expect(exists).toBe(false);
    });

    it("deleteClass removes a loaded class", async () => {
      // Load a sacrificial standalone package.
      const victim = `MwTest_doomed_${Date.now()}`;
      await client.loadString({
        data: `model ${victim}\nend ${victim};\n`,
        filename: `<runtime:${victim}>`,
      });
      const before = await client.existClass({ typeName: victim });
      expect(before.exists).toBe(true);

      const del = await client.deleteClass({ typeName: victim });
      expect(del.success).toBe(true);

      const after = await client.existClass({ typeName: victim });
      expect(after.exists).toBe(false);
    });

    it("copyClass duplicates a class (destination must be a quoted String per OMC docs)", async () => {
      const dupName = `${fixture.packageName}_Copy`;
      const { result } = await client.copyClass({
        source: fixture.modelClass,
        destination: dupName,
      });
      expect(result).toBe(true);
      const { exists } = await client.existClass({ typeName: dupName });
      expect(exists).toBe(true);
      await client.deleteClass({ typeName: dupName });
    });

    it("moveClassToTop / moveClassToBottom reorder children of a package", async () => {
      // The default fixture only has one nested class. Load a richer
      // package via loadString so we can observe the reorder.
      const { randomBytes } = await import("node:crypto");
      const id = randomBytes(4).toString("hex");
      const pkg = `MwReorder_${id}`;
      await client.loadString({
        data: `package ${pkg}
  model A
  end A;
  model B
  end B;
  model C
  end C;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
      try {
        // Move C to top — C should now precede A and B.
        const top = await client.moveClassToTop({ typeName: `${pkg}.C` });
        expect(top.success).toBe(true);
        const afterTop = await client.getClassNames({
          typeName: pkg,
          qualified: false,
        });
        expect(afterTop.classNames[0]).toBe("C");

        // Move C to bottom — C should now follow A and B.
        const bot = await client.moveClassToBottom({ typeName: `${pkg}.C` });
        expect(bot.success).toBe(true);
        const afterBottom = await client.getClassNames({
          typeName: pkg,
          qualified: false,
        });
        expect(afterBottom.classNames[afterBottom.classNames.length - 1]).toBe(
          "C",
        );
      } finally {
        await client.deleteClass({ typeName: pkg });
      }
    });
  });

  // === Editing: components and connections ===

  describe("editing", () => {
    let fixture: Fixture;

    beforeEach(async () => {
      fixture = await loadFixture(client);
    });

    afterEach(async () => {
      await disposeFixture(client, fixture);
    });

    it("addComponent / updateComponent / renameComponent / deleteComponent", async () => {
      const add = await client.addComponent({
        componentName: "x",
        componentClass: "Real",
        intoTypeName: fixture.modelClass,
      });
      expect(add.success).toBe(true);

      let { components } = await client.getComponents({
        typeName: fixture.modelClass,
      });
      expect(components.map((c) => c.name)).toContain("x");

      const upd = await client.updateComponent({
        componentName: "x",
        componentClass: "Real",
        intoTypeName: fixture.modelClass,
        annotation:
          "Placement(transformation=transformation(extent={{-10,-10},{10,10}}))",
      });
      expect(upd.success).toBe(true);

      const ren = await client.renameComponent({
        typeName: fixture.modelClass,
        oldName: "x",
        newName: "y",
      });
      expect(Array.isArray(ren.rewrittenDeclarations)).toBe(true);

      ({ components } = await client.getComponents({
        typeName: fixture.modelClass,
      }));
      const names = components.map((c) => c.name);
      expect(names).toContain("y");
      expect(names).not.toContain("x");

      const del = await client.deleteComponent({
        componentName: "y",
        typeName: fixture.modelClass,
      });
      expect(del.success).toBe(true);

      ({ components } = await client.getComponents({
        typeName: fixture.modelClass,
      }));
      expect(components.map((c) => c.name)).not.toContain("y");
    });

    it("addConnection / deleteConnection on a model with two connectors", async () => {
      await client.addComponent({
        componentName: "uIn",
        componentClass: "Modelica.Blocks.Interfaces.RealInput",
        intoTypeName: fixture.modelClass,
      });
      await client.addComponent({
        componentName: "yOut",
        componentClass: "Modelica.Blocks.Interfaces.RealOutput",
        intoTypeName: fixture.modelClass,
      });

      const add = await client.addConnection({
        from: "uIn",
        to: "yOut",
        typeName: fixture.modelClass,
      });
      expect(add.success).toBe(true);

      const { count } = await client.getConnectionCount({
        typeName: fixture.modelClass,
      });
      expect(count).toBe(1);

      const del = await client.deleteConnection({
        from: "uIn",
        to: "yOut",
        typeName: fixture.modelClass,
      });
      expect(del.success).toBe(true);

      const after = await client.getConnectionCount({
        typeName: fixture.modelClass,
      });
      expect(after.count).toBe(0);
    });

    it("setComponentDimensions and setComponentComment update component metadata", async () => {
      await client.addComponent({
        componentName: "v",
        componentClass: "Real",
        intoTypeName: fixture.modelClass,
      });

      const dims = await client.setComponentDimensions({
        typeName: fixture.modelClass,
        componentName: "v",
        dimensions: ["3"],
      });
      expect(dims.success).toBe(true);

      const cmt = await client.setComponentComment({
        typeName: fixture.modelClass,
        componentName: "v",
        comment: "test parameter array",
      });
      expect(cmt.success).toBe(true);

      const { components } = await client.getComponents({
        typeName: fixture.modelClass,
      });
      const v = components.find((c) => c.name === "v");
      expect(v?.dimensions).toEqual(["3"]);
      expect(v?.comment).toBe("test parameter array");
    });

    it("addClassAnnotation attaches a class-level annotation", async () => {
      const { success } = await client.addClassAnnotation({
        typeName: fixture.modelClass,
        annotation: "annotate=experiment(StopTime=2.0, Tolerance=1e-6)",
      });
      expect(success).toBe(true);

      const { isExperiment } = await client.isExperiment({
        typeName: fixture.modelClass,
      });
      expect(isExperiment).toBe(true);
    });

    it("setComponentProperties (6-arg shape on OMC 1.26)", async () => {
      await client.addComponent({
        componentName: "p",
        componentClass: "Real",
        intoTypeName: fixture.modelClass,
      });
      const { success } = await client.setComponentProperties({
        typeName: fixture.modelClass,
        componentName: "p",
        finalPrefix: false,
        flow: false,
        stream: false,
        protectedPrefix: false,
        replaceablePrefix: false,
        variability: "parameter",
        inner: false,
        outer: false,
        direction: "",
      });
      expect(success).toBe(true);

      const { components } = await client.getComponents({
        typeName: fixture.modelClass,
      });
      const p = components.find((c) => c.name === "p");
      expect(p?.variability).toBe("parameter");
    });
  });

  // === Parameters & modifiers (writes) ===

  describe("parameters", () => {
    let fixture: Fixture;

    beforeEach(async () => {
      fixture = await loadParameterFixture(client);
    });

    afterEach(async () => {
      await disposeFixture(client, fixture);
    });

    it("setComponentModifierValue updates a parameter's value", async () => {
      const set = await client.setComponentModifierValue({
        typeName: fixture.modelClass,
        modifier: "k",
        expr: "42.0",
      });
      expect(set.success).toBe(true);

      const { value } = await client.getComponentModifierValue({
        typeName: fixture.modelClass,
        modifier: "k",
      });
      expect(value).toContain("42");
    });
  });
});
