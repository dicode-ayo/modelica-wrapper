/**
 * Live integration tests for the indexed / count contents readers added in
 * issue #34: getComponentCount, getNthComponent[/Annotation/Condition/
 * Modification], getAnnotationCount, getNthAnnotationString, the algorithm /
 * initial-algorithm section + item families, and the equation /
 * initial-equation section + item families.
 *
 * Spins up OMC, loads a single `loadString` fixture rich enough to exercise
 * each accessor (multiple components incl. a conditional one, multiple
 * class-level annotations, an `algorithm` section, an `initial algorithm`
 * section, an `equation` section, and an `initial equation` section), then
 * walks each count/Nth pair.
 *
 * Auto-skips when `omc` isn't on PATH.
 */

import { execSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";

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

describeIf("indexed / count contents readers (live OMC)", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeAll(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwIdx_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    // A self-contained model (no stdlib needed) with:
    //  - 3 components, one of which is conditional (`Real cond if use_cond;`)
    //  - 2 class-level annotation sections (experiment + a dialog/version-style one)
    //  - an `initial algorithm` section (1 statement)
    //  - an `algorithm` section (2 statements)
    //  - an `initial equation` section (1 equation)
    //  - an `equation` section (2 equations)
    const data = `package ${pkg}
  model Sample
    parameter Boolean use_cond = true;
    parameter Real a = 1.0;
    Real b;
    Real cond if use_cond;
  initial algorithm
    b := a;
  algorithm
    b := a + 1;
    b := b * 2;
  initial equation
    b = a;
  equation
    b = a + time;
    der(b) = 0;
    annotation(experiment(StartTime = 0, StopTime = 1));
    annotation(Documentation(info = "<html>doc</html>"));
  end Sample;
end ${pkg};
`;
    const { success } = await client.loadString({
      data,
      filename: `<indexed-readers-fixture:${pkg}>`,
    });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadString failed: ${errorString}`);
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await client.deleteClass({ typeName: pkg });
    } catch {
      // best-effort cleanup
    }
    await client.close();
  });

  // === Components ===

  it("getComponentCount counts the declared components", async () => {
    const { count } = await client.getComponentCount({ typeName: cls });
    // use_cond, a, b, cond -> 4 declared components.
    expect(count).toBe(4);
  });

  it("getNthComponent returns a non-empty expression tree for each component", async () => {
    const { count } = await client.getComponentCount({ typeName: cls });
    for (let n = 1; n <= count; n++) {
      const { result } = await client.getNthComponent({ typeName: cls, n });
      // Each component row is a non-null Value tree (list/call/etc).
      expect(result.kind).not.toBe("null");
    }
  });

  it("getNthComponentAnnotation returns a Value tree per component", async () => {
    const { result } = await client.getNthComponentAnnotation({
      typeName: cls,
      n: 1,
    });
    expect(result).toBeDefined();
    expect(typeof result.kind).toBe("string");
  });

  it("getNthComponentCondition surfaces the conditional component's predicate", async () => {
    const { count } = await client.getComponentCount({ typeName: cls });
    const conditions: string[] = [];
    for (let n = 1; n <= count; n++) {
      const { result } = await client.getNthComponentCondition({
        typeName: cls,
        n,
      });
      conditions.push(result);
    }
    // Exactly the `cond` component carries an `if use_cond` condition.
    const nonEmpty = conditions.filter((c) => c.length > 0);
    expect(nonEmpty.length).toBe(1);
    expect(nonEmpty[0]).toContain("use_cond");
  });

  it("getNthComponentModification returns a Value tree for a modified component", async () => {
    // `a = 1.0` is a modified parameter; just assert the call parses to a Value.
    const { result } = await client.getNthComponentModification({
      typeName: cls,
      n: 1,
    });
    expect(result).toBeDefined();
    expect(typeof result.kind).toBe("string");
  });

  // === Class-level annotations ===

  it("getAnnotationCount + getNthAnnotationString walk the class annotations", async () => {
    const { count } = await client.getAnnotationCount({ typeName: cls });
    expect(count).toBeGreaterThanOrEqual(2);
    const strings: string[] = [];
    for (let i = 1; i <= count; i++) {
      const { result } = await client.getNthAnnotationString({
        typeName: cls,
        index: i,
      });
      strings.push(result);
    }
    const joined = strings.join("\n");
    expect(joined).toContain("experiment");
    expect(joined).toContain("Documentation");
  });

  // === Algorithm sections ===

  it("getAlgorithmCount + getNthAlgorithm read the algorithm section(s)", async () => {
    const { count } = await client.getAlgorithmCount({ typeName: cls });
    expect(count).toBe(1);
    const { result } = await client.getNthAlgorithm({
      typeName: cls,
      index: 1,
    });
    expect(result).toContain("b");
  });

  it("getAlgorithmItemsCount + getNthAlgorithmItem read each statement", async () => {
    const { count } = await client.getAlgorithmItemsCount({ typeName: cls });
    expect(count).toBe(2);
    const items: string[] = [];
    for (let i = 1; i <= count; i++) {
      const { result } = await client.getNthAlgorithmItem({
        typeName: cls,
        index: i,
      });
      items.push(result);
    }
    expect(items.join("\n")).toContain(":=");
  });

  // === Initial algorithm sections ===

  it("getInitialAlgorithmCount + getNthInitialAlgorithm read the initial algorithm section(s)", async () => {
    const { count } = await client.getInitialAlgorithmCount({ typeName: cls });
    expect(count).toBe(1);
    const { result } = await client.getNthInitialAlgorithm({
      typeName: cls,
      index: 1,
    });
    expect(result).toContain("b");
  });

  it("getInitialAlgorithmItemsCount + getNthInitialAlgorithmItem read each initial statement", async () => {
    const { count } = await client.getInitialAlgorithmItemsCount({
      typeName: cls,
    });
    expect(count).toBe(1);
    const { result } = await client.getNthInitialAlgorithmItem({
      typeName: cls,
      index: 1,
    });
    expect(result).toContain(":=");
  });

  // === Equation sections ===

  it("getNthEquation reads the equation section", async () => {
    const { result } = await client.getNthEquation({ typeName: cls, index: 1 });
    expect(result.length).toBeGreaterThan(0);
  });

  it("getNthEquationItem reads each equation", async () => {
    const first = await client.getNthEquationItem({ typeName: cls, index: 1 });
    const second = await client.getNthEquationItem({ typeName: cls, index: 2 });
    expect(first.result.length).toBeGreaterThan(0);
    expect(second.result.length).toBeGreaterThan(0);
    // The two equations are distinct source lines.
    expect(first.result).not.toBe(second.result);
  });

  // === Initial equation sections ===

  it("getInitialEquationCount + getNthInitialEquation read the initial equation section(s)", async () => {
    const { count } = await client.getInitialEquationCount({ typeName: cls });
    expect(count).toBe(1);
    const { result } = await client.getNthInitialEquation({
      typeName: cls,
      index: 1,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it("getInitialEquationItemsCount + getNthInitialEquationItem read each initial equation", async () => {
    const { count } = await client.getInitialEquationItemsCount({
      typeName: cls,
    });
    expect(count).toBe(1);
    const { result } = await client.getNthInitialEquationItem({
      typeName: cls,
      index: 1,
    });
    expect(result.length).toBeGreaterThan(0);
  });
});
