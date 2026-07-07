import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemInstance, TreeInstance } from "@headless-tree/core";

import type {
  LibraryBrowserDataSource,
  LibraryClassInfo,
  LibrarySelectDetail,
} from "../library-browser/library-browser.component.js";
import "./library-tree.component.js";
import type { OmLibraryTree } from "./library-tree.component.js";
import type { LibraryTreeNode } from "./library-tree-model.js";

const FAKE_TREE: Record<string, LibraryClassInfo[]> = {
  __ROOT__: [
    { qualified: "Modelica", restriction: "package" },
    { qualified: "Complex", restriction: "operator record" },
  ],
  Modelica: [{ qualified: "Modelica.Blocks", restriction: "package" }],
};

const ALL_FLAT: LibraryClassInfo[] = [
  { qualified: "Modelica.Blocks.Math.Gain", restriction: "block" },
  { qualified: "Modelica.Blocks.Math.Add", restriction: "block" },
];

function makeSource(): {
  source: LibraryBrowserDataSource;
  listChildren: ReturnType<typeof vi.fn>;
  searchAll: ReturnType<typeof vi.fn>;
  iconSvg: ReturnType<typeof vi.fn>;
} {
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

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor: condition never became true");
}

function treeOf(el: OmLibraryTree): TreeInstance<LibraryTreeNode> {
  const tree = (el as unknown as { tree?: TreeInstance<LibraryTreeNode> }).tree;
  if (!tree) throw new Error("tree not initialised");
  return tree;
}

async function mount(
  source: LibraryBrowserDataSource | null,
): Promise<OmLibraryTree> {
  const el = document.createElement("om-library-tree") as OmLibraryTree;
  el.dataSource = source;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await flush();
  return el;
}

describe("<om-library-tree>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-library-tree")).toBeDefined();
  });

  it("renders a placeholder when no data source is configured", async () => {
    const el = await mount(null);
    expect(el.shadowRoot?.querySelector(".empty")?.textContent).toContain(
      "No library data source",
    );
  });

  it("lazily lists top-level classes via listChildren(null)", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    expect(listChildren).toHaveBeenCalledWith(null);
    const ids = treeOf(el)
      .getItems()
      .map((i) => i.getId());
    expect(ids).toContain("Modelica");
    expect(ids).toContain("Complex");
  });

  it("lazily lists a package's children only when it expands", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    expect(listChildren).not.toHaveBeenCalledWith("Modelica");

    treeOf(el).getItemInstance("Modelica").expand();
    await waitFor(() =>
      treeOf(el)
        .getItems()
        .some(
          (i: ItemInstance<LibraryTreeNode>) => i.getId() === "Modelica.Blocks",
        ),
    );
    expect(listChildren).toHaveBeenCalledWith("Modelica");
  });

  it("switches to searchAll for a non-empty query and back to the tree when cleared", async () => {
    const { source, searchAll, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    // Root load is the only listChildren so far; search must not re-list.
    expect(listChildren).toHaveBeenCalledTimes(1);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchAll.mock.calls.length > 0);
    expect(searchAll).toHaveBeenCalledWith("gain");

    input.value = "";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    // Back to tree mode: query cleared, no extra searchAll, tree data intact.
    expect(input.value).toBe("");
    expect(searchAll).toHaveBeenCalledTimes(1);
    expect(treeOf(el).getItems().length).toBeGreaterThanOrEqual(2);
  });

  it("emits om-library-select with the activated className", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const selected: string[] = [];
    el.addEventListener("om-library-select", (e) => {
      selected.push((e as CustomEvent<LibrarySelectDetail>).detail.className);
    });
    treeOf(el).getItemInstance("Complex").primaryAction();
    expect(selected).toEqual(["Complex"]);
  });

  it("issues a lazy icon request when a row renders", async () => {
    const { source, iconSvg } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    // `<lit-virtualizer>` doesn't render rows under happy-dom, so drive the
    // row renderer directly — the per-row icon fetch is the invariant.
    const renderRow = (
      el as unknown as {
        renderRow(item: ItemInstance<LibraryTreeNode>): unknown;
      }
    ).renderRow.bind(el);
    for (const item of treeOf(el).getItems()) renderRow(item);

    const requested = iconSvg.mock.calls.map((c) => c[0]);
    expect(requested).toContain("Modelica");
    expect(requested).toContain("Complex");
  });
});
