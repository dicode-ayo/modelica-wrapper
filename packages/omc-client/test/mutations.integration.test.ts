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
 *   class-create wrappers          — the undocumented create-class scripting
 *                                     calls were removed (genuinely absent on
 *                                     OMC 1.26.x — "Class X not found"). Use
 *                                     `newModel` instead (verified below); see
 *                                     coverage.md "Removed wrappers".
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
  loadDerivedExtendsFixture,
  loadExtendsFixture,
  loadFixture,
  loadParameterFixture,
  type DerivedExtendsFixture,
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

    it("loadFiles batch-loads multiple .mo files in one call", async () => {
      const dir = await mkdtemp(join(tmpdir(), "mw-loadfiles-"));
      try {
        const fileA = join(dir, "PkgA.mo");
        const fileB = join(dir, "PkgB.mo");
        const { randomBytes } = await import("node:crypto");
        const id = randomBytes(4).toString("hex");
        const pkgA = `MwLoad_A_${id}`;
        const pkgB = `MwLoad_B_${id}`;
        await writeFile(
          fileA,
          `package ${pkgA}\n  model M end M;\nend ${pkgA};\n`,
          "utf8",
        );
        await writeFile(
          fileB,
          `package ${pkgB}\n  model M end M;\nend ${pkgB};\n`,
          "utf8",
        );
        const { success } = await client.loadFiles({
          fileNames: [fileA, fileB],
        });
        expect(success).toBe(true);
        const aLoaded = await client.existClass({ typeName: pkgA });
        const bLoaded = await client.existClass({ typeName: pkgB });
        expect(aLoaded.exists).toBe(true);
        expect(bLoaded.exists).toBe(true);
        await client.deleteClass({ typeName: pkgA });
        await client.deleteClass({ typeName: pkgB });
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

    it("newModel creates an empty model inside an existing package and it reads back", async () => {
      // newModel(className, withinPath) is the documented replacement on
      // OMC 1.26.x for the absent (now-removed) create-class wrappers. It
      // always creates a `model` nested inside an already-loaded package; there is
      // no top-level form (an empty withinPath is rejected by OMC's parser),
      // so the package must exist first. See coverage.md Lifecycle.
      const { randomBytes } = await import("node:crypto");
      const id = randomBytes(4).toString("hex");
      const pkg = `MwNew_${id}`;
      await client.loadString({
        data: `package ${pkg}\nend ${pkg};\n`,
        filename: `<fixture:${pkg}>`,
      });
      try {
        const before = await client.existClass({ typeName: `${pkg}.Sub` });
        expect(before.exists).toBe(false);

        const created = await client.newModel({
          typeName: "Sub",
          withinPath: pkg,
        });
        expect(created.success).toBe(true);

        // Round-trip: the new class resolves and is a `model`.
        const after = await client.existClass({ typeName: `${pkg}.Sub` });
        expect(after.exists).toBe(true);

        const { classNames } = await client.getClassNames({
          typeName: pkg,
          qualified: false,
        });
        expect(classNames).toContain("Sub");

        const { b: isModel } = await client.isModel({ typeName: `${pkg}.Sub` });
        expect(isModel).toBe(true);
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

    it("updateConnectionNames renames one or both endpoints of an existing connection", async () => {
      // updateConnectionNames is the rename-edge variant of updateConnection:
      // it leaves the annotation alone but rewrites either or both of the
      // (from, to) endpoint identifiers. Same String-quoting gotcha as the
      // surrounding transition mutators — see audit.md §2.10.
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

      // Rename `uIn` -> `uInRenamed` first via renameComponentInClass so the
      // endpoint identifier exists in the symbol table, then rewrite the
      // connection's `from` endpoint to match.
      await client.renameComponentInClass({
        typeName: fixture.modelClass,
        oldName: "uIn",
        newName: "uInRenamed",
      });

      const ren = await client.updateConnectionNames({
        typeName: fixture.modelClass,
        from: "uIn",
        to: "yOut",
        fromNew: "uInRenamed",
        toNew: "yOut",
      });
      expect(ren.success).toBe(true);

      // Verify via the connection reader that endpoint 1 of the only
      // connection now points at the renamed component.
      const { from: gotFrom, to: gotTo } = await client.getNthConnection({
        typeName: fixture.modelClass,
        index: 1,
      });
      expect(gotFrom).toBe("uInRenamed");
      expect(gotTo).toBe("yOut");

      await client.deleteConnection({
        from: "uInRenamed",
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

    it("setClassComment updates a class's description string", async () => {
      const newComment = "Updated by the integration suite";
      const { success } = await client.setClassComment({
        typeName: fixture.modelClass,
        filename: newComment,
      });
      expect(success).toBe(true);
      const { comment } = await client.getClassComment({
        typeName: fixture.modelClass,
      });
      expect(comment).toBe(newComment);
    });

    it("setDocumentationAnnotation writes info + revisions HTML", async () => {
      const info = "<html><body><h1>Info</h1></body></html>";
      const revisions = "<html><body><p>v1.0</p></body></html>";
      const { bool } = await client.setDocumentationAnnotation({
        typeName: fixture.modelClass,
        info,
        revisions,
      });
      expect(bool).toBe(true);
      const { info: gotInfo } = await client.getDocumentationAnnotation({
        typeName: fixture.modelClass,
      });
      expect(gotInfo).toContain("Info");
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

    it("setParameterValue binds a new value to a parameter", async () => {
      const { success } = await client.setParameterValue({
        typeName: fixture.modelClass,
        variableName: "k",
        value: "7.5",
      });
      expect(success).toBe(true);
      const { value } = await client.getParameterValue({
        typeName: fixture.modelClass,
        name: "k",
      });
      expect(value).toContain("7.5");
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

      const { initialStates } = await client.getInitialStates({
        typeName: cls,
      });
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
      const { initialStates } = await client.getInitialStates({
        typeName: cls,
      });
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

      const { initialStates } = await client.getInitialStates({
        typeName: cls,
      });
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

    it("updateTransition replaces the guard, flags, priority, and annotation of an existing transition", async () => {
      // Round-trip: read the fixture's transition row, ask OMC to update
      // it with a fresh guard + flag set, then read back and assert the
      // new values landed. Same String-quoting gotcha as the other
      // transition mutators — see audit.md §2.10.
      const before = await client.getTransitions({ typeName: cls });
      expect(before.transitions.length).toBe(1);
      const [from, to, oldCondition, oldImm, oldRes, oldSync, oldPrio] =
        before.transitions[0]!;

      const upd = await client.updateTransition({
        typeName: cls,
        from: from!,
        to: to!,
        oldCondition: oldCondition!,
        oldImmediate: oldImm === "true",
        oldReset: oldRes === "true",
        oldSynchronize: oldSync === "true",
        oldPriority: Number(oldPrio),
        newCondition: "time > 5",
        newImmediate: false,
        newReset: false,
        newSynchronize: false,
        newPriority: 3,
        annotation: "Line(points={{-20,0},{20,0}})",
      });
      expect(upd.success).toBe(true);

      const after = await client.getTransitions({ typeName: cls });
      expect(after.transitions.length).toBe(1);
      const [, , newCond, newImm, newRes, newSync, newPrio] =
        after.transitions[0]!;
      expect(newCond).toMatch(/time\s*>\s*5/);
      expect(newImm).toBe("false");
      expect(newRes).toBe("false");
      expect(newSync).toBe("false");
      expect(Number(newPrio)).toBe(3);
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

  // === Extends-clause modifiers on a self-contained base/derived fixture ===
  //
  // The fixture defines its own `Base` (with `parameter Real k = 1.0`) and a
  // `Derived` that does `extends Base(k = 2.5)`, so the modifier lives inside
  // the same package — no Modelica library load needed, and the read path
  // surfaces `k` (unlike the Gain-based fixture above).

  describe("extends-modifier readers/writer (self-contained fixture)", () => {
    let fixture: DerivedExtendsFixture;

    beforeEach(async () => {
      fixture = await loadDerivedExtendsFixture(client);
    });

    afterEach(async () => {
      await disposeFixture(client, fixture);
    });

    it("getExtendsModifierNames returns {k} for Derived's extends clause", async () => {
      const { modifiers } = await client.getExtendsModifierNames({
        typeName: fixture.derivedClass,
        extendsBase: fixture.baseClass,
      });
      expect(modifiers).toContain("k");
    });

    it("getExtendsModifierValue returns =2.5 for Derived / Base / k", async () => {
      const { value } = await client.getExtendsModifierValue({
        typeName: fixture.derivedClass,
        extendsBase: fixture.baseClass,
        modifier: "k",
      });
      // OMC returns the binding with a leading `=`.
      expect(value).toContain("2.5");
    });

    it("isExtendsModifierFinal reports false for a non-final modifier", async () => {
      const { isFinal } = await client.isExtendsModifierFinal({
        typeName: fixture.derivedClass,
        extendsName: fixture.baseClass,
        modifierName: "k",
      });
      expect(isFinal).toBe(false);
    });

    it("setExtendsModifierValue sets k=3.7 and the listFile round-trip shows it", async () => {
      const { success } = await client.setExtendsModifierValue({
        typeName: fixture.derivedClass,
        extendsBase: fixture.baseClass,
        modifier: "k",
        expr: "3.7",
      });
      expect(success).toBe(true);

      const { contents } = await client.listFile({
        typeName: fixture.derivedClass,
      });
      expect(contents).toMatch(/k\s*=\s*3\.7/);
    });

    it("setExtendsModifier replaces the whole extends modification", async () => {
      // setExtendsModifier takes a full modification, not a single element.
      const { success } = await client.setExtendsModifier({
        typeName: fixture.derivedClass,
        extendsName: fixture.baseClass,
        modifier: "(k = 9.9)",
      });
      expect(success).toBe(true);

      const { contents } = await client.listFile({
        typeName: fixture.derivedClass,
      });
      expect(contents).toMatch(/k\s*=\s*9\.9/);
    });
  });

  // === Derived-class (short-class-definition) modifier readers ===
  //
  // getDerivedClassModifier{Names,Value} target a SHORT class definition that
  // derives from a base type with attribute modifiers, e.g.
  // `type Resistance = Real(quantity="Resistance", unit="Ohm")`.

  describe("derived-class modifier readers", () => {
    let pkg: string;
    let cls: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwDerived_${randomBytes(4).toString("hex")}`;
      cls = `${pkg}.Resistance`;
      await client.loadString({
        data: `package ${pkg}
  type Resistance = Real(quantity = "Resistance", unit = "Ohm");
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("getDerivedClassModifierNames lists the base-type modifier names", async () => {
      const { modifierNames } = await client.getDerivedClassModifierNames({
        typeName: cls,
      });
      expect(modifierNames).toContain("quantity");
      expect(modifierNames).toContain("unit");
    });

    it("getDerivedClassModifierValue reads a single base-type modifier value", async () => {
      const unit = await client.getDerivedClassModifierValue({
        typeName: cls,
        modifierName: "unit",
      });
      expect(unit.modifierValue).toContain("Ohm");

      const quantity = await client.getDerivedClassModifierValue({
        typeName: cls,
        modifierName: "quantity",
      });
      expect(quantity.modifierValue).toContain("Resistance");
    });
  });

  // === Class predicates needing custom fixtures ===
  //
  // The standard `Modelica` library doesn't expose top-level classes with
  // the literal `class` restriction, `replaceable` elements, or protected
  // nested classes — these tests load a tiny throwaway package that
  // explicitly carries each construct.

  describe("class predicates with fixtures", () => {
    let pkg: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwPred_${randomBytes(4).toString("hex")}`;
      await client.loadString({
        data: `package ${pkg}
  class Foo
    Real x;
  end Foo;

  block Outer
    replaceable Real r = 1.0;
  protected
    class Inner
      Real y;
    end Inner;
  end Outer;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("isClass distinguishes `class` from `block` restrictions", async () => {
      const fooIsClass = await client.isClass({ typeName: `${pkg}.Foo` });
      expect(fooIsClass.b).toBe(true);
      const outerIsClass = await client.isClass({ typeName: `${pkg}.Outer` });
      // `block` is a separate restriction; isClass returns false.
      expect(outerIsClass.b).toBe(false);
    });

    it("isReplaceable detects a `replaceable` element", async () => {
      const { b } = await client.isReplaceable({
        typeName: `${pkg}.Outer.r`,
      });
      expect(b).toBe(true);
    });

    it("isProtectedClass detects a protected nested class (with a counter-example)", async () => {
      const protectedHit = await client.isProtectedClass({
        typeName: `${pkg}.Outer`,
        c2: "Inner",
      });
      expect(protectedHit.b).toBe(true);
      // `r` is the public replaceable element — NOT a protected class.
      const publicMiss = await client.isProtectedClass({
        typeName: `${pkg}.Outer`,
        c2: "r",
      });
      expect(publicMiss.b).toBe(false);
    });
  });

  // === Browsing extras needing a custom inheritance / short-class fixture ===

  describe("browsing extras", () => {
    let pkg: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwExtras_${randomBytes(4).toString("hex")}`;
      // A 3-class inheritance chain A <- B <- C plus a short class definition
      // and a class carrying an annotation. The `extends` clauses are written
      // fully-qualified: on OMC 1.26.7, `extendsFrom` matches the base class
      // against the directly-listed (fully-qualified) extends clauses.
      await client.loadString({
        data: `package ${pkg}
  model A
    Real a;
  end A;

  model B
    extends ${pkg}.A;
    Real b;
  end B;

  model C
    extends ${pkg}.B;
    Real c;
    annotation(experiment(StopTime = 1));
  end C;

  type T = Real;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("extendsFrom matches the directly-listed base class (non-transitive on 1.26.7)", async () => {
      // C extends B directly → true.
      const directCB = await client.extendsFrom({
        typeName: `${pkg}.C`,
        baseClassName: `${pkg}.B`,
      });
      expect(directCB.res).toBe(true);

      // B extends A directly → true.
      const directBA = await client.extendsFrom({
        typeName: `${pkg}.B`,
        baseClassName: `${pkg}.A`,
      });
      expect(directBA.res).toBe(true);

      // C extends A only transitively. On OMC 1.26.7 `extendsFrom` is
      // NON-transitive — it matches against the directly-listed extends
      // clauses only — so this is false. (Documented in the wrapper.)
      const transitiveCA = await client.extendsFrom({
        typeName: `${pkg}.C`,
        baseClassName: `${pkg}.A`,
      });
      expect(transitiveCA.res).toBe(false);

      // A does NOT extend from C.
      const reverse = await client.extendsFrom({
        typeName: `${pkg}.A`,
        baseClassName: `${pkg}.C`,
      });
      expect(reverse.res).toBe(false);
    });

    it("getAllSubtypeOf enumerates loaded subtypes of A", async () => {
      // Searched across all loaded classes, names come back fully-qualified
      // and the class itself is included in the result.
      const { classNames } = await client.getAllSubtypeOf({
        typeName: `${pkg}.A`,
      });
      expect(Array.isArray(classNames)).toBe(true);
      // B and C both extend (transitively) from A; A itself is included.
      expect(classNames).toEqual(
        expect.arrayContaining([`${pkg}.A`, `${pkg}.B`, `${pkg}.C`]),
      );
    });

    it("classAnnotationExists distinguishes a class with vs. without an annotation", async () => {
      const present = await client.classAnnotationExists({
        typeName: `${pkg}.C`,
        annotationName: "experiment",
      });
      expect(present.exists).toBe(true);

      const absent = await client.classAnnotationExists({
        typeName: `${pkg}.A`,
        annotationName: "experiment",
      });
      expect(absent.exists).toBe(false);
    });

    it("getNthInheritedClass agrees with the bulk getInheritedClasses", async () => {
      const { inheritedClasses } = await client.getInheritedClasses({
        typeName: `${pkg}.C`,
      });
      expect(inheritedClasses.length).toBeGreaterThan(0);

      // 1-based indexing — the first inherited class should match index 1.
      const { baseClass } = await client.getNthInheritedClass({
        typeName: `${pkg}.C`,
        n: 1,
      });
      expect(baseClass).toBe(inheritedClasses[0]);
    });

    it("isShortDefinition is true for `type T = Real;` and false for a model", async () => {
      const shortHit = await client.isShortDefinition({
        typeName: `${pkg}.T`,
      });
      expect(shortHit.isShortCls).toBe(true);

      const modelMiss = await client.isShortDefinition({
        typeName: `${pkg}.A`,
      });
      expect(modelMiss.isShortCls).toBe(false);
    });
  });

  // === Class-shape / component predicates added in #33 ===
  //
  // Nine `is*` predicates with three distinct argument shapes:
  //   - isConstant / isParameter / isProtected: TWO TypeNames
  //     (componentName, className); output `result`.
  //   - isPrimitive: single TypeName (className); output `result`.
  //   - isRedeclare / isOperator / isOperatorFunction / isOperatorRecord /
  //     isOptimization: single TypeName; output `b`.
  // Each is exercised on a `loadString` fixture that exhibits the trait,
  // most with a counter-example to guard against constant-true regressions.

  describe("class-shape predicates with fixtures (#33)", () => {
    let pkg: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwShape_${randomBytes(4).toString("hex")}`;
      await client.loadString({
        data: `package ${pkg}
  model Subj
    constant Real cc = 1.0;
    parameter Real pp = 2.0;
    Real xx;
  protected
    Real prot;
  end Subj;

  operator record Cplx
    Real re;
    Real im;
    encapsulated operator function 'addReal'
      import ${pkg}.Cplx;
      input Cplx a;
      input Cplx b;
      output Cplx c;
    algorithm
      c := Cplx(a.re + b.re, a.im + b.im);
    end 'addReal';
  end Cplx;

  partial model Base
    replaceable Real rr = 1.0;
  end Base;

  model Derived
    extends Base;
    redeclare Real rr = 2.0;
    Real plain = 3.0;
  end Derived;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("isConstant detects a `constant` component (with a counter-example)", async () => {
      const hit = await client.isConstant({
        typeName: `${pkg}.Subj`,
        componentName: "cc",
      });
      expect(hit.result).toBe(true);
      const miss = await client.isConstant({
        typeName: `${pkg}.Subj`,
        componentName: "pp",
      });
      expect(miss.result).toBe(false);
    });

    it("isParameter detects a `parameter` component (with a counter-example)", async () => {
      const hit = await client.isParameter({
        typeName: `${pkg}.Subj`,
        componentName: "pp",
      });
      expect(hit.result).toBe(true);
      const miss = await client.isParameter({
        typeName: `${pkg}.Subj`,
        componentName: "cc",
      });
      expect(miss.result).toBe(false);
    });

    it("isProtected detects a protected component (with a counter-example)", async () => {
      const hit = await client.isProtected({
        typeName: `${pkg}.Subj`,
        componentName: "prot",
      });
      expect(hit.result).toBe(true);
      const miss = await client.isProtected({
        typeName: `${pkg}.Subj`,
        componentName: "xx",
      });
      expect(miss.result).toBe(false);
    });

    it("isPrimitive detects a built-in primitive type (with a counter-example)", async () => {
      const hit = await client.isPrimitive({ typeName: "Real" });
      expect(hit.result).toBe(true);
      const miss = await client.isPrimitive({ typeName: `${pkg}.Subj` });
      expect(miss.result).toBe(false);
    });

    it("isRedeclare detects a redeclared element (with a counter-example)", async () => {
      const hit = await client.isRedeclare({ typeName: `${pkg}.Derived.rr` });
      expect(hit.b).toBe(true);
      const miss = await client.isRedeclare({
        typeName: `${pkg}.Derived.plain`,
      });
      expect(miss.b).toBe(false);
    });

    it("isOperatorRecord detects an `operator record` (with a counter-example)", async () => {
      const hit = await client.isOperatorRecord({ typeName: `${pkg}.Cplx` });
      expect(hit.b).toBe(true);
      const miss = await client.isOperatorRecord({ typeName: `${pkg}.Subj` });
      expect(miss.b).toBe(false);
    });

    it("isOperatorFunction detects an `operator function` (with a counter-example)", async () => {
      const hit = await client.isOperatorFunction({
        typeName: `${pkg}.Cplx.'addReal'`,
      });
      expect(hit.b).toBe(true);
      const miss = await client.isOperatorFunction({
        typeName: `${pkg}.Cplx`,
      });
      expect(miss.b).toBe(false);
    });

    it("isOperator detects an `operator` class (with a counter-example)", async () => {
      // A standalone `operator` block lives inside the operator record.
      const { randomBytes } = await import("node:crypto");
      const opPkg = `MwOp_${randomBytes(4).toString("hex")}`;
      await client.loadString({
        data: `package ${opPkg}
  operator record Cplx
    Real re;
    Real im;
    operator 'fromReal'
      function build
        input Real r;
        output Cplx c;
      algorithm
        c := Cplx(r, 0.0);
      end build;
    end 'fromReal';
  end Cplx;
end ${opPkg};
`,
        filename: `<fixture:${opPkg}>`,
      });
      try {
        const hit = await client.isOperator({
          typeName: `${opPkg}.Cplx.'fromReal'`,
        });
        expect(hit.b).toBe(true);
        const miss = await client.isOperator({ typeName: `${opPkg}.Cplx` });
        expect(miss.b).toBe(false);
      } finally {
        await client.deleteClass({ typeName: opPkg });
      }
    });

    it("isOptimization detects an `optimization` class (with a counter-example)", async () => {
      // `optimization` is Optimica grammar; enable it before loading.
      await client.setCommandLineOptions({ options: "+g=Optimica" });
      const { randomBytes } = await import("node:crypto");
      const optPkg = `MwOpt_${randomBytes(4).toString("hex")}`;
      await client.loadString({
        data: `package ${optPkg}
  optimization Opt
    Real q(start = 0.0);
  equation
    der(q) = 1.0;
  end Opt;

  model Plain
    Real z;
  end Plain;
end ${optPkg};
`,
        filename: `<fixture:${optPkg}>`,
      });
      try {
        const hit = await client.isOptimization({
          typeName: `${optPkg}.Opt`,
        });
        expect(hit.b).toBe(true);
        const miss = await client.isOptimization({
          typeName: `${optPkg}.Plain`,
        });
        expect(miss.b).toBe(false);
      } finally {
        await client.deleteClass({ typeName: optPkg });
      }
    });
  });

  // === Connector readers needing a class that declares connectors directly ===

  describe("connectors", () => {
    let pkg: string;
    let cls: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwConn_${randomBytes(4).toString("hex")}`;
      cls = `${pkg}.WithConn`;
      // `Modelica.*` blocks like `Math.Add` declare their connectors via
      // extends inheritance, which `getConnectorCount` doesn't count.
      // Declare the connectors directly here so the count is non-zero.
      await client.loadModel({ typeName: "Modelica" });
      await client.loadString({
        data: `package ${pkg}
  block WithConn
    Modelica.Blocks.Interfaces.RealInput u;
    Modelica.Blocks.Interfaces.RealOutput y;
  equation
    y = u;
  end WithConn;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("getConnectorCount counts directly-declared connectors", async () => {
      const { count } = await client.getConnectorCount({ typeName: cls });
      expect(count).toBe(2);
    });

    it("getNthConnector returns the connector declaration as a Value tree", async () => {
      const { result } = await client.getNthConnector({
        typeName: cls,
        n: 1,
      });
      expect(result.kind).toBe("list");
      // The wrapper returns a Value tree of [name, typeName, ...]; serialize
      // to JSON for a quick existence check on either of those fields.
      const json = JSON.stringify(result);
      expect(json).toMatch(/"u"|"y"/);
      expect(json).toMatch(/Modelica\.Blocks\.Interfaces\.Real(Input|Output)/);
    });

    it("getNthConnectorIconAnnotation returns the icon annotation as a Value tree", async () => {
      const { result } = await client.getNthConnectorIconAnnotation({
        typeName: cls,
        n: 1,
      });
      expect(result.kind).toBe("list");
      // RealInput/Output icons declare extents like {{-100,-100},{100,100}}.
      expect(JSON.stringify(result)).toContain("100");
    });
  });

  // === Import-clause readers (getImportCount / getNthImport) ===
  //
  // The fixture mirrors issue #43: one plain `import` and one renamed
  // `import M = Modelica;`. `getImportCount` should see both; `getNthImport`
  // returns the first as `[path, id, kind]`.

  describe("import readers", () => {
    let pkg: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwImp_${randomBytes(4).toString("hex")}`;
      await client.loadModel({ typeName: "Modelica" });
      await client.loadString({
        data: `package ${pkg}
  import Modelica.SIunits;
  import M = Modelica;
  model X
  end X;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("getImportCount counts both import-clauses", async () => {
      const { count } = await client.getImportCount({ typeName: pkg });
      expect(count).toBe(2);
    });

    it("getNthImport returns the first import as [path, id, kind]", async () => {
      const first = await client.getNthImport({ typeName: pkg, index: 1 });
      // Plain `import Modelica.SIunits;` → path is the dotted package, id is
      // empty (no rename). Field order is OMC-verbatim; values themselves are
      // OMC-derived strings.
      expect(typeof first.path).toBe("string");
      expect(typeof first.id).toBe("string");
      expect(typeof first.kind).toBe("string");
      expect(first.path).toContain("Modelica");
      expect(first.id).toBe("");
    });
  });

  // === Element mutations (round-trip via Element readers) ===
  //
  // These exercise OMC's modern `Component*` generalization. Two subtleties:
  // - `setElementType`'s `typeName` is the FULL dotted element path
  //   (e.g. `Pkg.Sample.k`), not the class name.
  // - `setElementModifierValue`'s `elementName` is the modifier path, like
  //   `k.start`. To clear a top-level parameter binding use
  //   `setComponentModifierValue` / `setParameterValue` instead.

  describe("element mutations", () => {
    let pkg: string;
    let cls: string;

    beforeEach(async () => {
      const { randomBytes } = await import("node:crypto");
      pkg = `MwElem_${randomBytes(4).toString("hex")}`;
      cls = `${pkg}.Sample`;
      await client.loadModel({ typeName: "Modelica" });
      await client.loadString({
        data: `package ${pkg}
  model Sample
    parameter Real k = 1.0 annotation(Dialog(group="x"));
    Modelica.Blocks.Math.Gain gain(k=2.5);
    Real x;
  equation
    x = k + gain.y;
  end Sample;
end ${pkg};
`,
        filename: `<fixture:${pkg}>`,
      });
    });

    afterEach(async () => {
      await client.deleteClass({ typeName: pkg });
    });

    it("setElementType changes the declared type of an element", async () => {
      // `typeName` is the FULL dotted element path here, not the class name.
      const { success } = await client.setElementType({
        typeName: `${cls}.k`,
        newTypeName: "Integer",
      });
      expect(success).toBe(true);
      // Verify via listFile so we don't depend on a still-🟡 reader.
      const { contents } = await client.listFile({ typeName: cls });
      expect(contents).toMatch(/parameter\s+Integer\s+k/);
    });

    it("setElementModifierValue sets a sub-modifier on a typed sub-component", async () => {
      // Modifier path `gain.k` — set the inner gain's `k` modifier to 7.0.
      const { success } = await client.setElementModifierValue({
        typeName: cls,
        elementName: "gain.k",
        expr: "7.0",
      });
      expect(success).toBe(true);
      const { value } = await client.getElementModifierValue({
        typeName: cls,
        modifier: "gain.k",
      });
      expect(value).toContain("7.0");
    });

    it("removeElementModifiers clears all modifiers on a typed sub-component", async () => {
      // Sanity: the fixture binds `gain.k = 2.5`.
      const before = await client.getElementModifierValue({
        typeName: cls,
        modifier: "gain.k",
      });
      expect(before.value).toContain("2.5");

      const { success } = await client.removeElementModifiers({
        typeName: cls,
        componentName: "gain",
      });
      expect(success).toBe(true);

      // After clearing, gain.k's modifier value should be empty.
      const after = await client.getElementModifierValue({
        typeName: cls,
        modifier: "gain.k",
      });
      expect(after.value).toBe("");
    });

    // setElementAnnotation needs the OMEdit-canonical `$Code((<expr>))`
    // shape — the leading-`=` form `$Code(=<expr>)` is silently destructive
    // on OMC 1.26.7 (returns true but clears the annotation). See issue #38
    // and the drift-probe counter-example for the regression watch.
    it("setElementAnnotation replaces the annotation body via $Code((…))", async () => {
      // Sanity: fixture binds `parameter Real k = 1.0 annotation(Dialog(group="x"));`.
      const before = (await client.listFile({ typeName: cls })).contents;
      expect(before).toMatch(/group\s*=\s*"x"/);

      const { success } = await client.setElementAnnotation({
        typeName: `${cls}.k`,
        annotationMod: 'Dialog(group="Tuning", tab="Advanced")',
      });
      expect(success).toBe(true);

      const after = (await client.listFile({ typeName: cls })).contents;
      // The new annotation body replaces the old one — old group="x" is
      // gone, new group="Tuning" and tab="Advanced" are present.
      expect(after).toMatch(/group\s*=\s*"Tuning"/);
      expect(after).toMatch(/tab\s*=\s*"Advanced"/);
      expect(after).not.toMatch(/group\s*=\s*"x"/);
    });

    it("setElementAnnotation accepts an empty annotationMod to clear", async () => {
      // Sanity: annotation is initially present.
      const before = (await client.listFile({ typeName: cls })).contents;
      expect(before).toMatch(/\bannotation\s*\(/);

      const { success } = await client.setElementAnnotation({
        typeName: `${cls}.k`,
        annotationMod: "",
      });
      expect(success).toBe(true);

      const after = (await client.listFile({ typeName: cls })).contents;
      // The parameter line no longer carries an `annotation(...)` block.
      // (Other declarations in the model may still have annotations, so we
      // narrow to the `parameter Real k` line.)
      const kLine = after.match(/parameter\s+Real\s+k[\s\S]*?;/);
      expect(kLine).not.toBeNull();
      expect(kLine?.[0]).not.toMatch(/\bannotation\s*\(/);
    });
  });
});
