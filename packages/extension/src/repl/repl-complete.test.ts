/**
 * Unit tests for Tab-completion plan generation.
 *
 * `computeCompletion` is intentionally pure: it gets the buffer + cursor,
 * returns the matching prefix + candidate list + longest-common-prefix.
 * The pty turns that plan into terminal output — those redraws are tested
 * separately.
 */

import { describe, expect, it } from "vitest";

import { computeCompletion } from "./repl-complete.js";

describe("computeCompletion — OMC function names", () => {
  it("on empty buffer suggests every OMC function", () => {
    const plan = computeCompletion("", 0);
    expect(plan.prefix).toBe("");
    // 100+ candidates — sanity-check rather than enumerating.
    expect(plan.candidates.length).toBeGreaterThan(50);
    // Sorted alphabetically.
    expect([...plan.candidates].sort()).toEqual(plan.candidates);
  });

  it("narrows to functions starting with the prefix", () => {
    const plan = computeCompletion("getCl", 5);
    expect(plan.prefix).toBe("getCl");
    expect(plan.candidates).toContain("getClassInformation");
    expect(plan.candidates).toContain("getClassNames");
    expect(plan.candidates).toContain("getClassComment");
    // Should NOT include unrelated names.
    expect(plan.candidates).not.toContain("simulate");
  });

  it("produces the longest common prefix for an ambiguous match", () => {
    // `getCl…` matches several — every one starts with "getClass".
    const plan = computeCompletion("getCl", 5);
    expect(plan.commonPrefix).toMatch(/^getClass/);
    expect(plan.commonPrefix.length).toBeGreaterThan(plan.prefix.length);
  });

  it("returns a unique completion when only one candidate matches", () => {
    // `simul` should uniquely complete to `simulate`.
    const plan = computeCompletion("simul", 5);
    expect(plan.candidates).toEqual(["simulate"]);
    expect(plan.commonPrefix).toBe("simulate");
  });

  it("returns no candidates for an unmatchable prefix", () => {
    const plan = computeCompletion("zzz_no_such_thing", "zzz_no_such_thing".length);
    expect(plan.candidates).toEqual([]);
    expect(plan.commonPrefix).toBe("");
  });
});

describe("computeCompletion — meta-commands", () => {
  it("on `:` lists every meta-command", () => {
    const plan = computeCompletion(":", 1);
    expect(plan.prefix).toBe(":");
    expect(plan.candidates).toContain(":help");
    expect(plan.candidates).toContain(":load");
    expect(plan.candidates).toContain(":cd");
    expect(plan.candidates).toContain(":reset");
    expect(plan.candidates).toContain(":exit");
    expect(plan.candidates).toContain(":clear");
  });

  it("`:lo` uniquely completes to `:load`", () => {
    const plan = computeCompletion(":lo", 3);
    expect(plan.candidates).toEqual([":load"]);
    expect(plan.commonPrefix).toBe(":load");
  });

  it("after `:help ` the source switches to OMC names", () => {
    // ":help getCl" — the `getCl` token isn't a meta-verb, so we expect
    // OMC name candidates rather than meta-commands.
    const buf = ":help getCl";
    const plan = computeCompletion(buf, buf.length);
    expect(plan.prefix).toBe("getCl");
    expect(plan.candidates).toContain("getClassInformation");
    // No `:help` slipping through.
    expect(plan.candidates).not.toContain(":help");
  });
});

describe("computeCompletion — cursor position", () => {
  it("completes the word ending at the cursor, ignoring text after", () => {
    // Cursor sits right after `getCl` — text after shouldn't be considered.
    const buf = "getCl(extra)";
    const plan = computeCompletion(buf, 5);
    expect(plan.prefix).toBe("getCl");
    expect(plan.candidates).toContain("getClassInformation");
  });
});
