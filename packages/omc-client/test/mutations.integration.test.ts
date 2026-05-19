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
  loadExtendsFixture,
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

    it("moveClass shifts a class by an integer offset within its parent", async () => {
      // moveClass on OMC 1.26.x is an *in-place* reorder by signed Integer
      // offset (positive = down, negative = up), NOT a cross-package
      // relocate. Earlier wrapper versions treated the second arg as a
      // TypeName destination and were silently broken; see audit.md §2.10.
      const { randomBytes } = await import("node:crypto");
      const id = randomBytes(4).toString("hex");
      const pkg = `MwMove_${id}`;
      await client.loadString({
        data: `package ${pkg}
  model A end A;
  model B end B;
  model C end C;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
      try {
        // Move A down by 2 — order should become B, C, A.
        const moved = await client.moveClass({
          typeName: `${pkg}.A`,
          offset: 2,
        });
        expect(moved.success).toBe(true);
        const after = await client.getClassNames({
          typeName: pkg,
          qualified: false,
        });
        expect(after.classNames).toEqual(["B", "C", "A"]);
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

      // renameComponentInClass — single-class variant (no cross-class
      // rewriting). Confirmed to work on OMC 1.26.7; returns a list with
      // the target class as the sole entry.
      const inClass = await client.renameComponentInClass({
        typeName: fixture.modelClass,
        oldName: "y",
        newName: "z",
      });
      expect(inClass.rewrittenDeclarations).toContain(fixture.modelClass);
      ({ components } = await client.getComponents({
        typeName: fixture.modelClass,
      }));
      expect(components.map((c) => c.name)).toContain("z");
      // Restore the name so the rest of the test (delete) still applies.
      await client.renameComponentInClass({
        typeName: fixture.modelClass,
        oldName: "z",
        newName: "y",
      });

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

    it("addConnection / updateConnection / deleteConnection roundtrip", async () => {
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
      await client.addConnection({
        from: "uIn",
        to: "yOut",
        typeName: fixture.modelClass,
      });

      // updateConnection now sends docs-correct (className, from, to, annotate)
      // with from/to quoted. Earlier wrapper versions had the arg order
      // wrong and were silently broken; see audit.md §2.10.
      const upd = await client.updateConnection({
        typeName: fixture.modelClass,
        from: "uIn",
        to: "yOut",
        annotation: "Line(points={{-20,0},{20,0}}, thickness=0.5)",
      });
      expect(upd.success).toBe(true);

      // Confirm the annotation actually changed — OMC normalizes kwargs
      // into positional record fields, so we can't grep for `thickness`
      // by name. Instead assert the Line() call appears with the 0.5
      // thickness float somewhere in the positional payload.
      const { annotation } = await client.getNthConnectionAnnotation({
        typeName: fixture.modelClass,
        index: 1,
      });
      expect(annotation.kind === "list" || annotation.kind === "call").toBe(
        true,
      );
      expect(JSON.stringify(annotation)).toMatch(/"Line"/);
      expect(JSON.stringify(annotation)).toContain("0.5");

      await client.deleteConnection({
        from: "uIn",
        to: "yOut",
        typeName: fixture.modelClass,
      });
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

    it("removeComponentModifiers clears modifiers on a typed sub-component", async () => {
      // The parameter fixture's `Sample` has only a primitive `k` parameter
      // — removeComponentModifiers needs a *typed* sub-component. Load a
      // richer fixture inline.
      const { randomBytes } = await import("node:crypto");
      const pkg = `MwRcm_${randomBytes(4).toString("hex")}`;
      const cls = `${pkg}.Sample`;
      await client.loadString({
        data: `package ${pkg}
  model Sample
    Modelica.Blocks.Math.Gain gain(k=2.5);
  end Sample;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
      try {
        // Sanity: k modifier is currently bound to 2.5.
        const before = await client.getComponentModifierValue({
          typeName: cls,
          modifier: "gain.k",
        });
        expect(before.value).toContain("2.5");

        const { success } = await client.removeComponentModifiers({
          typeName: cls,
          componentName: "gain",
        });
        expect(success).toBe(true);

        const after = await client.getComponentModifierValue({
          typeName: cls,
          modifier: "gain.k",
        });
        expect(after.value).toBe("");
      } finally {
        await client.deleteClass({ typeName: pkg });
      }
    });
  });

  // === State-machine mutations ===

  describe("state-machine", () => {
    let pkg: string;
    let cls: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwSm_${randomBytes(4).toString("hex")}`;
      cls = `${pkg}.Sample`;
      await client.loadString({
        data: `package ${pkg}
  block Sample
    Boolean state1;
    Boolean state2;
    Boolean state3;
  equation
    initialState(state1);
    transition(state1, state2, time > 1, immediate=true, reset=true, synchronize=false, priority=1);
  end Sample;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("addInitialState marks an additional state initial", async () => {
      const { success } = await client.addInitialState({
        typeName: cls,
        state: "state2",
      });
      expect(success).toBe(true);

      const { initialStates } = await client.getInitialStates({ typeName: cls });
      const names = initialStates.map((row) => row[0]);
      expect(names).toContain("state1");
      expect(names).toContain("state2");
    });

    it("updateInitialState replaces the annotation on an existing initial state", async () => {
      const { success } = await client.updateInitialState({
        typeName: cls,
        state: "state1",
        annotation: "Placement(visible=false)",
      });
      expect(success).toBe(true);

      // OMC normalizes the kwarg `visible=false` into a positional
      // `Placement(false)` record, so we can't match by name. Just
      // assert the marker is still there and the annotation isn't empty.
      const { initialStates } = await client.getInitialStates({ typeName: cls });
      const row = initialStates.find((r) => r[0] === "state1");
      expect(row).toBeDefined();
      expect(row?.[1] ?? "").toMatch(/Placement/);
    });

    it("deleteInitialState clears the initial-state marker (state itself preserved)", async () => {
      // Add state2 as initial first so we can delete it.
      await client.addInitialState({ typeName: cls, state: "state2" });

      const { success } = await client.deleteInitialState({
        typeName: cls,
        state: "state2",
      });
      expect(success).toBe(true);

      const { initialStates } = await client.getInitialStates({ typeName: cls });
      const names = initialStates.map((row) => row[0]);
      expect(names).not.toContain("state2");
      // state1 (the original initial state) is preserved.
      expect(names).toContain("state1");
    });

    it("addTransition adds a transition between two states", async () => {
      // Pre-existing wrapper had a bare-ident-from/to bug; now fixed.
      const add = await client.addTransition({
        typeName: cls,
        from: "state2",
        to: "state3",
        condition: "time > 2",
        immediate: false,
        reset: false,
        synchronize: false,
        priority: 2,
      });
      expect(add.success).toBe(true);

      const after = await client.getTransitions({ typeName: cls });
      expect(after.transitions.length).toBe(2);
      const newRow = after.transitions.find(
        (r) => r[0] === "state2" && r[1] === "state3",
      );
      expect(newRow).toBeDefined();
    });

    it("deleteTransition removes the fixture's original transition", async () => {
      // Read what OMC stored for the loadString'd transition, then ask it
      // to delete using its own normalization. (Building synthetic input
      // strings is flaky because OMC silently no-ops on any arg mismatch
      // — `condition` whitespace is the usual culprit.)
      const before = await client.getTransitions({ typeName: cls });
      expect(before.transitions.length).toBe(1);
      const [from, to, condition, immediate, reset, synchronize, priority] =
        before.transitions[0]!;

      const del = await client.deleteTransition({
        typeName: cls,
        from: from!,
        to: to!,
        condition: condition!,
        immediate: immediate === "true",
        reset: reset === "true",
        synchronize: synchronize === "true",
        priority: Number(priority),
      });
      expect(del.success).toBe(true);

      const after = await client.getTransitions({ typeName: cls });
      expect(after.transitions.length).toBe(0);
    });
  });

  // === Extends-clause mutations ===

  describe("extends", () => {
    let fixture: Fixture;

    beforeEach(async () => {
      await client.loadModel({ typeName: "Modelica" });
      fixture = await loadExtendsFixture(client);
    });

    afterEach(async () => {
      await disposeFixture(client, fixture);
    });

    it("removeExtendsModifiers clears all modifiers on an extends clause", async () => {
      // Sanity: the fixture's source carries `extends … Gain(k = 2.5)`.
      const before = await client.listFile({ typeName: fixture.modelClass });
      expect(before.contents).toContain("k = 2.5");

      const { success } = await client.removeExtendsModifiers({
        typeName: fixture.modelClass,
        extendsBase: "Modelica.Blocks.Math.Gain",
      });
      expect(success).toBe(true);

      // After clearing, the `k = 2.5` modifier should be gone from the
      // listed source. (We round-trip via listFile because
      // getExtendsModifierValue's read path doesn't surface modifiers on
      // this OMC version — separately tracked.)
      const after = await client.listFile({ typeName: fixture.modelClass });
      expect(after.contents).not.toContain("k = 2.5");
    });
  });
});
