import { describe, expect, it } from "vitest";

import type { LibraryClassInfo } from "./library-types.js";
import { buildSearchTree } from "./search-tree.js";

const info = (
  qualified: string,
  restriction: LibraryClassInfo["restriction"] = "block",
): LibraryClassInfo => ({ qualified, restriction });

describe("buildSearchTree", () => {
  it("is empty for no results", () => {
    expect(buildSearchTree([])).toEqual([]);
  });

  it("expands a deep match into indented ancestor rows leading to it", () => {
    const rows = buildSearchTree([info("Modelica.Blocks.Math.Gain")]);
    expect(rows.map((r) => [r.label, r.level])).toEqual([
      ["Modelica", 0],
      ["Blocks", 1],
      ["Math", 2],
      ["Gain", 3],
    ]);
    // Only the leaf is a match; the rest are synthetic ancestor packages.
    expect(rows.map((r) => r.isMatch)).toEqual([false, false, false, true]);
    expect(rows.at(-1)?.restriction).toBe("block");
    expect(rows.slice(0, 3).every((r) => r.restriction === "package")).toBe(
      true,
    );
    expect(rows.at(-1)?.hasChildren).toBe(false);
    expect(rows[0]?.hasChildren).toBe(true);
  });

  it("shares common ancestors across matches instead of repeating them", () => {
    const rows = buildSearchTree([
      info("Modelica.Blocks.Math.Gain"),
      info("Modelica.Blocks.Math.Add"),
    ]);
    // One Modelica / Blocks / Math spine, two leaves under it (sorted).
    expect(rows.map((r) => r.qualified)).toEqual([
      "Modelica",
      "Modelica.Blocks",
      "Modelica.Blocks.Math",
      "Modelica.Blocks.Math.Add",
      "Modelica.Blocks.Math.Gain",
    ]);
    expect(rows.filter((r) => r.isMatch).map((r) => r.qualified)).toEqual([
      "Modelica.Blocks.Math.Add",
      "Modelica.Blocks.Math.Gain",
    ]);
  });

  it("marks a node that is both a match and an ancestor", () => {
    const rows = buildSearchTree([
      info("Modelica", "package"),
      info("Modelica.Blocks", "package"),
    ]);
    const modelica = rows.find((r) => r.qualified === "Modelica");
    expect(modelica?.isMatch).toBe(true);
    expect(modelica?.hasChildren).toBe(true);
  });

  it("does not flatten to a single qualified-name row", () => {
    const rows = buildSearchTree([info("A.B.C")]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.label)).not.toContain("A.B.C");
  });
});
