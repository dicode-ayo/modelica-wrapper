/**
 * Fake `LibraryDataSource` for stories. In the extension this is
 * wired to OMC (`getClassNames` / `getClassRestriction` / icon SVG); here
 * a static tree + substring search stand in so the library tree (and the
 * add-component flow it drives) work without an extension host.
 */

import type {
  LibraryDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
} from "../../src/library-tree/library-types.js";

type FakeEntry = readonly [string, LibraryClassRestriction];

const FAKE_TREE: Record<string, readonly FakeEntry[]> = {
  __ROOT__: [
    ["Modelica", "package"],
    ["Complex", "operator record"],
  ],
  Modelica: [
    ["Modelica.Blocks", "package"],
    ["Modelica.Mechanics", "package"],
    ["Modelica.Math", "package"],
  ],
  "Modelica.Blocks": [
    ["Modelica.Blocks.Math", "package"],
    ["Modelica.Blocks.Sources", "package"],
    ["Modelica.Blocks.Continuous", "package"],
  ],
  "Modelica.Blocks.Math": [
    ["Modelica.Blocks.Math.Gain", "block"],
    ["Modelica.Blocks.Math.Add", "block"],
    ["Modelica.Blocks.Math.Sum", "block"],
  ],
  "Modelica.Blocks.Sources": [
    ["Modelica.Blocks.Sources.Constant", "block"],
    ["Modelica.Blocks.Sources.Step", "block"],
    ["Modelica.Blocks.Sources.Sine", "block"],
  ],
  "Modelica.Blocks.Continuous": [
    ["Modelica.Blocks.Continuous.Integrator", "block"],
    ["Modelica.Blocks.Continuous.PID", "block"],
  ],
  "Modelica.Math": [
    ["Modelica.Math.sin", "function"],
    ["Modelica.Math.cos", "function"],
  ],
};

const ALL_FLAT: LibraryClassInfo[] = (() => {
  const seen = new Set<string>();
  const out: LibraryClassInfo[] = [];
  for (const rows of Object.values(FAKE_TREE)) {
    for (const [qualified, restriction] of rows) {
      if (seen.has(qualified)) continue;
      seen.add(qualified);
      out.push({ qualified, restriction });
    }
  }
  return out;
})();

export const fakeLibrarySource: LibraryDataSource = {
  async listChildren(parent) {
    await new Promise((r) => setTimeout(r, 80));
    const rows = FAKE_TREE[parent ?? "__ROOT__"] ?? [];
    return rows.map(([qualified, restriction]) => ({ qualified, restriction }));
  },
  async searchAll(query) {
    await new Promise((r) => setTimeout(r, 80));
    const q = query.toLowerCase();
    return ALL_FLAT.filter((info) => info.qualified.toLowerCase().includes(q));
  },
};
