/**
 * Shared fixture data + a spy-backed `LibraryDataSource` for the
 * `<om-library-tree>` unit tests. Mirrors how `stories/fixtures/fake-library.ts`
 * factors story data, kept out of the test file so several suites can reuse it.
 */

import { vi } from "vitest";

import type { LibraryDataSource, LibraryClassInfo } from "./library-types.js";

/** `listChildren` responses keyed by parent id; `__ROOT__` is `listChildren(null)`. */
export const FAKE_TREE: Record<string, LibraryClassInfo[]> = {
  __ROOT__: [
    { qualified: "Modelica", restriction: "package" },
    { qualified: "Complex", restriction: "operator record" },
    { qualified: "Sine", restriction: "model" },
    { qualified: "Resistor", restriction: "model" },
    { qualified: "Pin", restriction: "connector" },
  ],
  Modelica: [{ qualified: "Modelica.Blocks", restriction: "package" }],
  // A non-package restriction that nests a class, same as #345's repro.
  Resistor: [{ qualified: "Resistor.Inner", restriction: "model" }],
};

/** Flat corpus `searchAll` filters over. */
export const ALL_FLAT: LibraryClassInfo[] = [
  { qualified: "Modelica.Blocks.Math.Gain", restriction: "block" },
  { qualified: "Modelica.Blocks.Math.Add", restriction: "block" },
];

export interface FakeLibrarySource {
  source: LibraryDataSource;
  listChildren: ReturnType<typeof vi.fn>;
  searchAll: ReturnType<typeof vi.fn>;
  iconSvg: ReturnType<typeof vi.fn>;
}

/** A `LibraryDataSource` over the fixtures with each method spied. */
export function makeFakeLibrarySource(): FakeLibrarySource {
  const listChildren = vi.fn(
    async (parent: string | null): Promise<LibraryClassInfo[]> =>
      (parent === null ? FAKE_TREE["__ROOT__"] : FAKE_TREE[parent]) ?? [],
  );
  const searchAll = vi.fn(async (q: string) =>
    ALL_FLAT.filter((i) => i.qualified.toLowerCase().includes(q.toLowerCase())),
  );
  const iconSvg = vi.fn(async () => undefined);
  return {
    source: { listChildren, searchAll, iconSvg },
    listChildren,
    searchAll,
    iconSvg,
  };
}
