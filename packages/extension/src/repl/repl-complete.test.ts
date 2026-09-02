/**
 * Unit tests for Tab-completion plan generation.
 *
 * `computeCompletion` is intentionally pure: it gets the buffer + cursor,
 * returns the matching prefix + candidate list + longest-common-prefix.
 * The pty turns that plan into terminal output — those redraws are tested
 * separately.
 */

import { describe, expect, it } from "vitest";

import {
  computeCompletion,
  computeGhost,
  formatColumns,
} from "./repl-complete.js";

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
    const plan = computeCompletion(
      "zzz_no_such_thing",
      "zzz_no_such_thing".length,
    );
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

describe("computeCompletion — path-argument meta-commands", () => {
  it("offers nothing for a `:load` path, even one ending like an OMC name", () => {
    // "modifierToJSON" sorts alphabetically ahead of the "mo" this path ends in.
    const buf = ":load /tmp/scratchpad/LoadProbe.mo";
    const plan = computeCompletion(buf, buf.length);
    expect(plan.candidates).toEqual([]);
    expect(plan.commonPrefix).toBe("");
  });

  it("offers nothing for a `:cd` path", () => {
    const buf = ":cd /tmp/some/dir";
    const plan = computeCompletion(buf, buf.length);
    expect(plan.candidates).toEqual([]);
  });

  it("decides on the text up to the cursor, not text after it", () => {
    // Cursor sits right after the verb; the path typed after the cursor
    // hasn't been reached yet, so the verb itself is still a completion
    // target.
    const buf = ":load /tmp/scratchpad/LoadProbe.mo";
    const plan = computeCompletion(buf, ":load".length);
    expect(plan.candidates).toEqual([":load"]);
    expect(plan.prefix).toBe(":load");
  });

  it("still completes the `:load` verb itself before the space", () => {
    const plan = computeCompletion(":lo", 3);
    expect(plan.candidates).toEqual([":load"]);
  });

  it("still completes the `:cd` verb itself before the space", () => {
    const plan = computeCompletion(":c", 2);
    expect(plan.candidates).toEqual([":cd", ":clear"]);
  });

  it("still completes OMC names after `:help `", () => {
    const buf = ":help getCl";
    const plan = computeCompletion(buf, buf.length);
    expect(plan.candidates).toContain("getClassInformation");
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

describe("computeGhost", () => {
  it("returns the alphabetical first candidate's tail when cursor is at end", () => {
    // `getCl` matches several `getClass…` functions; sorted, the first is
    // `getClassComment`, so the ghost should be its tail.
    const ghost = computeGhost("getCl", 5);
    expect(ghost).toBe("assComment");
  });

  it("returns empty when cursor is not at end of buffer", () => {
    expect(computeGhost("getCl", 3)).toBe("");
  });

  it("returns empty when buffer is empty", () => {
    expect(computeGhost("", 0)).toBe("");
  });

  it("returns empty when nothing matches the prefix", () => {
    expect(computeGhost("zzz_no_match", "zzz_no_match".length)).toBe("");
  });

  it("works for meta-command prefixes", () => {
    // `:lo` uniquely matches `:load` → ghost is the tail.
    expect(computeGhost(":lo", 3)).toBe("ad");
  });

  it("returns empty after a unique completion is fully typed", () => {
    // The buffer is itself an OMC function name; the only candidate IS
    // the buffer, so the tail is empty.
    expect(computeGhost("simulate", "simulate".length)).toBe("");
  });

  it("suggests nothing for a `:load` path argument", () => {
    const buf = ":load /tmp/scratchpad/LoadProbe.mo";
    expect(computeGhost(buf, buf.length)).toBe("");
  });
});

describe("formatColumns", () => {
  it("returns [] for an empty input", () => {
    expect(formatColumns([], 80)).toEqual([]);
  });

  it("lays out column-major so reading down columns gives sorted order", () => {
    const items = ["a", "b", "c", "d", "e"];
    // maxLen=1, colWidth=3 (gap=2), width 9 → numCols=3, numRows=2.
    // Column-major: col 1 = [a, b], col 2 = [c, d], col 3 = [e].
    const lines = formatColumns(items, 9);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("a  c  e");
    expect(lines[1]).toBe("b  d");
  });

  it("pads non-trailing columns to the longest item width", () => {
    const items = ["x", "longer", "y"];
    // maxLen=6, colWidth=8, width 80 → numCols=10, but only 3 items.
    // Single row, items are padded to colWidth and trailing space trimmed.
    const lines = formatColumns(items, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("x       longer  y");
  });

  it("falls back to one column when no column fits at the given width", () => {
    const lines = formatColumns(["abcdefghij", "klmnopqrst"], 5);
    expect(lines).toEqual(["abcdefghij", "klmnopqrst"]);
  });

  it("packs OMC function names tightly into a real terminal width", () => {
    // ~36-char max name, 120-col terminal → at least 3 columns expected.
    const items = [
      "addComponent",
      "addConnection",
      "addClassAnnotation",
      "checkModel",
      "deleteClass",
      "deleteComponent",
      "getClassInformation",
      "getClassNames",
      "loadString",
      "renameClass",
      "simulate",
      "updateComponent",
    ];
    const lines = formatColumns(items, 120);
    // 12 items, ≥3 cols → ≤4 rows.
    expect(lines.length).toBeLessThanOrEqual(4);
    // Every original item is present somewhere in the output.
    const joined = lines.join("");
    for (const item of items) expect(joined).toContain(item);
  });
});
