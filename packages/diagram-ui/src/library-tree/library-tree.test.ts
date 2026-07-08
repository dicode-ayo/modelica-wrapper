import { afterEach, describe, expect, it } from "vitest";
import type { ItemInstance, TreeInstance } from "@headless-tree/core";
import { RangeChangedEvent } from "@lit-labs/virtualizer/events.js";

import type {
  LibraryBrowserDataSource,
  LibraryClassInfo,
  LibrarySelectDetail,
} from "../library-browser/library-browser.component.js";
import "./library-tree.component.js";
import type { OmLibraryTree } from "./library-tree.component.js";
import type { LibraryTreeNode } from "./library-tree-model.js";
import {
  FAKE_TREE,
  makeFakeLibrarySource as makeSource,
} from "./library-tree.fixtures.js";

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

// happy-dom doesn't render `<lit-virtualizer>`, so the tree/data invariants
// are asserted through the (private) tree instance rather than the DOM.
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

  it("issues a lazy icon request for search rows in the virtualizer's rendered range", async () => {
    const { source, searchAll, iconSvg } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchAll.mock.calls.length > 0);
    await el.updateComplete;

    // `<lit-virtualizer>` doesn't mount under happy-dom (its constructor
    // needs a real ResizeObserver), so drive the `rangeChanged` handler
    // directly — the same limitation the existing tree test above works
    // around via `treeOf`/private-method casts.
    const onSearchRangeChanged = (
      el as unknown as { onSearchRangeChanged(e: RangeChangedEvent): void }
    ).onSearchRangeChanged.bind(el);
    onSearchRangeChanged(new RangeChangedEvent({ first: 0, last: 0 }));

    expect(iconSvg.mock.calls.map((c) => c[0])).toContain(
      "Modelica.Blocks.Math.Gain",
    );
  });

  it("drops an in-flight search that resolves after the query is cleared", async () => {
    let resolveSearch: (r: LibraryClassInfo[]) => void = () => {};
    let searchCalled = false;
    const source: LibraryBrowserDataSource = {
      async listChildren(parent) {
        return (
          (parent === null ? FAKE_TREE["__ROOT__"] : FAKE_TREE[parent]) ?? []
        );
      },
      searchAll: () =>
        new Promise<LibraryClassInfo[]>((res) => {
          searchCalled = true;
          resolveSearch = res;
        }),
    };
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchCalled);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    resolveSearch([
      { qualified: "Modelica.Blocks.Math.Gain", restriction: "block" },
    ]);
    await flush();

    const results = (
      el as unknown as { searchResults: LibraryClassInfo[] | null }
    ).searchResults;
    expect(results).toBeNull();
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

  it("does not issue an icon request merely from rendering a row", async () => {
    const { source, iconSvg } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    // Rendering must be side-effect-free — the fetch is driven by the
    // virtualizer's `rangeChanged` event, not by building the row template.
    const renderRow = (
      el as unknown as {
        renderRow(item: ItemInstance<LibraryTreeNode>): unknown;
      }
    ).renderRow.bind(el);
    for (const item of treeOf(el).getItems()) renderRow(item);

    expect(iconSvg).not.toHaveBeenCalled();
  });

  it("issues a lazy icon request for rows in the virtualizer's rendered range", async () => {
    const { source, iconSvg } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const onTreeRangeChanged = (
      el as unknown as { onTreeRangeChanged(e: RangeChangedEvent): void }
    ).onTreeRangeChanged.bind(el);
    const itemCount = treeOf(el).getItems().length;
    onTreeRangeChanged(
      new RangeChangedEvent({ first: 0, last: itemCount - 1 }),
    );

    const requested = iconSvg.mock.calls.map((c) => c[0]);
    expect(requested).toContain("Modelica");
    expect(requested).toContain("Complex");
  });

  it("resets search state when the data source is swapped", async () => {
    const first = makeSource();
    const el = await mount(first.source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => first.searchAll.mock.calls.length > 0);

    el.dataSource = makeSource().source;
    await el.updateComplete;

    const state = el as unknown as {
      query: string;
      searchResults: LibraryClassInfo[] | null;
      searchLoading: boolean;
      searchError: string | null;
    };
    expect(state.query).toBe("");
    expect(state.searchResults).toBeNull();
    expect(state.searchLoading).toBe(false);
    expect(state.searchError).toBeNull();
  });

  it("activates a search row on Enter and Space", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const selected: string[] = [];
    el.addEventListener("om-library-select", (e) => {
      selected.push((e as CustomEvent<LibrarySelectDetail>).detail.className);
    });
    // `<lit-virtualizer>` doesn't render search rows under happy-dom; drive the
    // keyboard handler directly to pin the activation invariant.
    const onKeydown = (
      el as unknown as {
        onSearchRowKeydown(e: KeyboardEvent, className: string): void;
      }
    ).onSearchRowKeydown.bind(el);
    onKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Modelica.Blocks",
    );
    onKeydown(new KeyboardEvent("keydown", { key: " " }), "Modelica.Blocks");
    onKeydown(new KeyboardEvent("keydown", { key: "a" }), "Modelica.Blocks");
    expect(selected).toEqual(["Modelica.Blocks", "Modelica.Blocks"]);
  });
});
