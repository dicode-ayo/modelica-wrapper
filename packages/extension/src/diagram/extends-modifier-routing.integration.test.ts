/**
 * Integration test: inherited-parameter writes land on the `extends`
 * clause, not as a host-level modifier (issue #24).
 *
 * Exercises the real producer + OMC routing end to end:
 *   1. `buildClassParameterForm` walks `Derived`'s extends chain and
 *      marks the inherited `k` with `inheritedFrom = "<pkg>.Base"`.
 *   2. We route the write the way `applyClassParameterEdits` does for an
 *      inherited param — `client.setExtendsModifierValue(host, base, k,
 *      expr)` (NOT `setElementModifierValue`).
 *   3. `listFile` shows the new value on the `extends …Base(k = …)`
 *      clause, and the host class did NOT grow a spurious top-level
 *      `k = …` modifier.
 *
 * The form builder is plain JSON logic, so its `inheritedFrom` capture
 * is covered by the unit tests; this file is the live half — proving OMC
 * actually routes the modifier where the producer says it should.
 *
 * Auto-skips when OMC isn't on PATH; honours `OMC_INTEGRATION=0/1` the
 * same way the omc-client integration suite does.
 */

import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { requireClassParameterForm } from "../../test-support/parameter-forms.js";
import { refOf } from "../../test-support/parameter-refs.js";

describeIf("inherited-parameter write routing (#24)", () => {
  let client: OmcClient;
  let pkg: string;
  let derivedClass: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    pkg = `MwExtRoute_${randomBytes(4).toString("hex")}`;
    derivedClass = `${pkg}.Derived`;
    // Self-contained base/derived pair: Base owns `parameter Real k`,
    // Derived reaches it purely through `extends Base(k = 2.5)`.
    const { success } = await client.loadString({
      data: `package ${pkg}
  model Base
    parameter Real k = 1.0;
  end Base;
  model Derived
    extends Base(k = 2.5);
  end Derived;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`fixture load failed: ${errorString}`);
    }
  });

  afterEach(async () => {
    try {
      await client.deleteClass({ typeName: pkg });
    } catch {
      // OMC closing / already gone — nothing to do.
    }
    await client.close();
  });

  it("the form builder marks `k` as inherited from Base", async () => {
    const { instance } = await client.getModelInstance({
      typeName: derivedClass,
    });
    const form = requireClassParameterForm(instance);
    const kRef = refOf(form.refs, "k");
    // The qualified ancestor name is what the submit handler passes as
    // `extendsBase`. OMC may emit it short (`Base`) or fully qualified
    // (`<pkg>.Base`) depending on the instance tree — assert it resolves
    // to Base either way.
    expect(kRef.inheritedFrom).toMatch(/(^|\.)Base$/);
  });

  it("routes the write through setExtendsModifierValue → modifier lands on the extends clause", async () => {
    const { instance } = await client.getModelInstance({
      typeName: derivedClass,
    });
    const form = requireClassParameterForm(instance);
    const { inheritedFrom } = refOf(form.refs, "k");
    if (inheritedFrom === undefined)
      throw new Error("expected 'k' to be inherited");

    // Route exactly as applyClassParameterEdits does for an inherited
    // param: setExtendsModifierValue(host, base, name, expr).
    const { success } = await client.setExtendsModifierValue({
      typeName: derivedClass,
      extendsBase: inheritedFrom,
      modifier: "k",
      expr: "3.7",
    });
    expect(success).toBe(true);

    const { contents } = await client.listFile({ typeName: derivedClass });
    // The new value rides on the `extends …Base(k = 3.7)` clause.
    expect(contents).toMatch(/extends[\s\S]*Base\([\s\S]*k\s*=\s*3\.7/);
    // And the host (Derived) did NOT grow a standalone `parameter Real k`
    // / top-level `k = 3.7` modifier — the modifier belongs on the
    // extends clause, not on the model body. (Derived has no own `k`
    // declaration, so a `parameter` line for k would be the bug.)
    expect(contents).not.toMatch(/parameter\s+Real\s+k/);
  });

  it("routes a 3-LEVEL inherited param to the direct base clause (issue #76, item 3)", async () => {
    // C extends B extends A; `p` is declared on the deepest ancestor A.
    // The direct extends clause on C is B, so the write must route through
    // setExtendsModifierValue(C, B, p, …) — NOT (C, A, …) which is a no-op
    // (C has no `extends A`) and silently loses the edit.
    const tri = `MwTri_${randomBytes(4).toString("hex")}`;
    const triC = `${tri}.C`;
    const load = await client.loadString({
      data: `package ${tri}
  model A
    parameter Real p = 1.0;
  end A;
  model B
    extends A;
  end B;
  model C
    extends B;
  end C;
end ${tri};
`,
      filename: `<fixture:${tri}>`,
    });
    expect(load.success).toBe(true);

    try {
      const { instance } = await client.getModelInstance({ typeName: triC });
      const form = requireClassParameterForm(instance);
      const { inheritedFrom } = refOf(form.refs, "p");
      if (inheritedFrom === undefined)
        throw new Error("expected 'p' to be inherited");
      // The captured base must be the DIRECT clause (B), not the deep
      // declaring class (A).
      expect(inheritedFrom).toMatch(/(^|\.)B$/);
      expect(inheritedFrom).not.toMatch(/(^|\.)A$/);

      const { success } = await client.setExtendsModifierValue({
        typeName: triC,
        extendsBase: inheritedFrom,
        modifier: "p",
        expr: "4.2",
      });
      expect(success).toBe(true);

      // The modifier rides the `extends …B(p = 4.2)` clause on C, proving
      // the write actually landed (it would be lost if routed to A).
      const { contents } = await client.listFile({ typeName: triC });
      expect(contents).toMatch(/extends[\s\S]*B\([\s\S]*p\s*=\s*4\.2/);
    } finally {
      await client.deleteClass({ typeName: tri });
    }
  });

  it("contrast: writing the same param via setElementModifierValue does NOT touch the extends clause", async () => {
    // Documents WHY the routing matters. setElementModifierValue targets
    // the host element scope; for an inherited param that's the wrong
    // place — the extends clause keeps its original `k = 2.5`.
    const { success } = await client.setElementModifierValue({
      typeName: derivedClass,
      elementName: "k",
      expr: "9.9",
    });
    // OMC tolerates the call (it succeeds), but the extends clause is
    // untouched — proving the host path is the wrong scope for this param.
    expect(typeof success).toBe("boolean");

    const { contents } = await client.listFile({ typeName: derivedClass });
    // The extends clause still carries the ORIGINAL 2.5, not 9.9 — the
    // element-path write didn't land where the inherited param lives.
    expect(contents).toMatch(/extends[\s\S]*Base\([\s\S]*k\s*=\s*2\.5/);
    expect(contents).not.toMatch(/Base\([\s\S]*k\s*=\s*9\.9/);
  });
});
