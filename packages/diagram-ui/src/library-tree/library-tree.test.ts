import { afterEach, describe, expect, it } from "vitest";
import { render, type TemplateResult } from "lit";
import type { ItemInstance, TreeInstance } from "@headless-tree/core";
import { RangeChangedEvent } from "@lit-labs/virtualizer/events.js";

import type {
  LibraryContextMenuDetail,
  LibraryDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
  LibrarySelectDetail,
} from "./library-types.js";
import "./library-tree.component.js";
import type {
  LibraryRootLoadedDetail,
  OmLibraryTree,
} from "./library-tree.component.js";
import type { LibraryTreeNode } from "./library-tree-model.js";
import type { SearchTreeRow } from "./search-tree.js";
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

async function mount(source: LibraryDataSource | null): Promise<OmLibraryTree> {
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

  it("emits om-library-root-loaded once its root list resolves", async () => {
    const { source } = makeSource();
    const events: LibraryRootLoadedDetail[] = [];
    // Listen before append so the initial root load can't fire first.
    const el = document.createElement("om-library-tree") as OmLibraryTree;
    el.addEventListener("om-library-root-loaded", (e) =>
      events.push((e as CustomEvent<LibraryRootLoadedDetail>).detail),
    );
    el.dataSource = source;
    document.body.appendChild(el);
    teardowns.push(() => el.remove());
    await waitFor(() => events.length > 0);
    expect(events[0]).toEqual({ ok: true, empty: false });
  });

  it("reports an empty root via om-library-root-loaded", async () => {
    const source: LibraryDataSource = {
      listChildren: async () => [],
      searchAll: async () => [],
    };
    const events: LibraryRootLoadedDetail[] = [];
    const el = document.createElement("om-library-tree") as OmLibraryTree;
    el.addEventListener("om-library-root-loaded", (e) =>
      events.push((e as CustomEvent<LibraryRootLoadedDetail>).detail),
    );
    el.dataSource = source;
    document.body.appendChild(el);
    teardowns.push(() => el.remove());
    await waitFor(() => events.length > 0);
    expect(events[0]).toEqual({ ok: true, empty: true });
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

  it("does not search on a single character", async () => {
    const { source, searchAll } = makeSource();
    const el = await mount(source);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "g";
    input.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 300));
    await el.updateComplete;

    // One character matches thousands of classes, each a serialized OMC call.
    expect(searchAll).not.toHaveBeenCalled();
  });

  it("searches once the query reaches the minimum length", async () => {
    const { source, searchAll } = makeSource();
    const el = await mount(source);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "ga";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchAll.mock.calls.length > 0);

    expect(searchAll).toHaveBeenCalledWith("ga", expect.any(AbortSignal));
  });

  it("aborts the in-flight search when the query is cleared", async () => {
    const { source, searchAll } = makeSource();
    let captured: AbortSignal | undefined;
    searchAll.mockImplementation(
      (_q: string, signal?: AbortSignal) =>
        new Promise(() => {
          captured = signal;
        }),
    );
    const el = await mount(source);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => captured !== undefined);
    expect(captured?.aborted).toBe(false);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;

    // The host drops its queued restriction lookups off this signal.
    expect(captured?.aborted).toBe(true);
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
    expect(searchAll).toHaveBeenCalledWith("gain", expect.any(AbortSignal));

    input.value = "";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    // Back to tree mode: query cleared, no extra searchAll, tree data intact.
    expect(input.value).toBe("");
    expect(searchAll).toHaveBeenCalledTimes(1);
    expect(treeOf(el).getItems().length).toBeGreaterThanOrEqual(2);
  });

  it("shows search matches in their package hierarchy, not a flat list", async () => {
    const { source, searchAll } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchAll.mock.calls.length > 0);
    await el.updateComplete;

    const rows = (el as unknown as { searchTreeRows: SearchTreeRow[] })
      .searchTreeRows;
    // Ancestor packages lead down to the match, indented — not a single
    // flat `Modelica.Blocks.Math.Gain` row.
    expect(rows.map((r) => [r.label, r.level, r.isMatch])).toEqual([
      ["Modelica", 0, false],
      ["Blocks", 1, false],
      ["Math", 2, false],
      ["Gain", 3, true],
    ]);
  });

  it("keeps working after interacting with a filtered row and clearing the query", async () => {
    const { source, searchAll } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchAll.mock.calls.length > 0);
    await el.updateComplete;

    const rows = (el as unknown as { searchTreeRows: SearchTreeRow[] })
      .searchTreeRows;
    const leaf = rows.find((r) => r.isMatch);
    if (!leaf) throw new Error("no match leaf");
    const priv = el as unknown as {
      onSearchRowClick(c: string): void;
      fireSelect(c: string, r: SearchTreeRow["restriction"]): void;
      selectedClassName: string | null;
      searchLoading: boolean;
    };
    const opened = onSelect(el);

    // Filtered-row interaction is keyed by className — no Headless Tree item.
    priv.onSearchRowClick(leaf.qualified); // single click selects
    expect(priv.selectedClassName).toBe(leaf.qualified);
    expect(opened).toEqual([]);
    priv.fireSelect(leaf.qualified, leaf.restriction); // double click / Enter opens
    expect(opened).toEqual([leaf.qualified]);

    // Clearing the query returns to a working, interactive lazy tree.
    input.value = "";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(priv.searchLoading).toBe(false);
    expect(treeOf(el).getItems().length).toBeGreaterThanOrEqual(2);
    const item = treeOf(el).getItemInstance("Complex");
    (
      el as unknown as { onItemClick(i: ItemInstance<LibraryTreeNode>): void }
    ).onItemClick(item);
    expect(item.isSelected()).toBe(true);
  });

  it("marks the matching segment and leaves ancestor labels unmarked", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    (el as unknown as { query: string }).query = "gain";
    const highlight = (
      el as unknown as { highlight(label: string): TemplateResult }
    ).highlight.bind(el);

    // happy-dom scrambles text bindings around a mid-template element, so this
    // asserts the `<mark>` element's presence, not its text content.
    const matched = document.createElement("div");
    render(highlight("Gain"), matched);
    expect(matched.querySelector("mark")).not.toBeNull();

    const ancestor = document.createElement("div");
    render(highlight("Blocks"), ancestor);
    expect(ancestor.querySelector("mark")).toBeNull();
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
    // directly.
    const onSearchRangeChanged = (
      el as unknown as { onSearchRangeChanged(e: RangeChangedEvent): void }
    ).onSearchRangeChanged.bind(el);
    // Rows are the filtered hierarchy Modelica → Blocks → Math → Gain; the
    // range spans them so the match leaf is included.
    onSearchRangeChanged(new RangeChangedEvent({ first: 0, last: 3 }));

    const requested = iconSvg.mock.calls.map((c) => c[0]);
    expect(requested).toContain("Modelica.Blocks.Math.Gain");
    // Ancestor packages keep their badge — no icon fetch for them.
    expect(requested).not.toContain("Modelica");
  });

  it("drops an in-flight search that resolves after the query is cleared", async () => {
    let resolveSearch: (r: LibraryClassInfo[]) => void = () => {};
    let searchCalled = false;
    const source: LibraryDataSource = {
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

  function onSelect(el: OmLibraryTree): string[] {
    const selected: string[] = [];
    el.addEventListener("om-library-select", (e) => {
      selected.push((e as CustomEvent<LibrarySelectDetail>).detail.className);
    });
    return selected;
  }

  /** Render a tree row standalone and return its `.row` element, so click /
   *  dblclick bindings can be exercised (the virtualizer doesn't mount here). */
  function renderRowEl(
    el: OmLibraryTree,
    item: ItemInstance<LibraryTreeNode>,
  ): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    teardowns.push(() => container.remove());
    const renderRow = (
      el as unknown as {
        renderRow(i: ItemInstance<LibraryTreeNode>): unknown;
      }
    ).renderRow.bind(el);
    render(renderRow(item) as never, container);
    const row = container.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("row not rendered");
    return row;
  }

  /** Render a search row standalone and return its `.row` element, mirroring
   *  `renderRowEl` for the filtered-tree path. */
  function renderSearchRowEl(
    el: OmLibraryTree,
    row: SearchTreeRow,
  ): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    teardowns.push(() => container.remove());
    const renderSearchTreeRow = (
      el as unknown as {
        renderSearchTreeRow(r: SearchTreeRow): unknown;
      }
    ).renderSearchTreeRow.bind(el);
    render(renderSearchTreeRow(row) as never, container);
    const found = container.querySelector<HTMLElement>(".row");
    if (!found) throw new Error("row not rendered");
    return found;
  }

  it("emits om-library-context-menu on a tree row right-click, suppressing the native menu", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Modelica");
    const events: LibraryContextMenuDetail[] = [];
    el.addEventListener("om-library-context-menu", (e) =>
      events.push((e as CustomEvent<LibraryContextMenuDetail>).detail),
    );

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 34,
    });
    const notPrevented = renderRowEl(el, item).dispatchEvent(event);

    expect(notPrevented).toBe(false);
    expect(events).toEqual([
      {
        className: "Modelica",
        restriction: "package",
        displayName: "Modelica",
        x: 12,
        y: 34,
      },
    ]);
  });

  it("emits om-library-context-menu on a search row right-click", async () => {
    const { source, searchAll } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector<HTMLInputElement>(".search");
    if (!input) throw new Error("search input missing");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(() => searchAll.mock.calls.length > 0);
    await el.updateComplete;

    const rows = (el as unknown as { searchTreeRows: SearchTreeRow[] })
      .searchTreeRows;
    const leaf = rows.find((r) => r.isMatch);
    if (!leaf) throw new Error("no match leaf");

    const events: LibraryContextMenuDetail[] = [];
    el.addEventListener("om-library-context-menu", (e) =>
      events.push((e as CustomEvent<LibraryContextMenuDetail>).detail),
    );
    renderSearchRowEl(el, leaf).dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 5,
        clientY: 6,
      }),
    );

    expect(events).toEqual([
      {
        className: leaf.qualified,
        restriction: leaf.restriction,
        displayName: leaf.label,
        x: 5,
        y: 6,
      },
    ]);
  });

  it("opens an openable class on keyboard activation (primaryAction)", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const selected = onSelect(el);
    treeOf(el).getItemInstance("Sine").primaryAction();
    expect(selected).toEqual(["Sine"]);
  });

  it("does not open a non-openable class on activation (packages, records)", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const selected = onSelect(el);
    treeOf(el).getItemInstance("Modelica").primaryAction();
    treeOf(el).getItemInstance("Complex").primaryAction();
    expect(selected).toEqual([]);
  });

  it("single click selects a row, it does not open it", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Sine");
    const selected = onSelect(el);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(item.isSelected()).toBe(true);
    expect(selected).toEqual([]);
  });

  it("double click opens an openable row", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Sine");
    const selected = onSelect(el);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(selected).toEqual(["Sine"]);
  });

  it("double click does not open a package row", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Modelica");
    const selected = onSelect(el);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(selected).toEqual([]);
  });

  it("chevron click toggles expansion without selecting", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Modelica");
    expect(item.isExpanded()).toBe(false);

    const selected: string[] = [];
    el.addEventListener("om-library-select", (e) => {
      selected.push((e as CustomEvent<LibrarySelectDetail>).detail.className);
    });
    let stopped = false;
    const event = {
      stopPropagation: () => {
        stopped = true;
      },
    } as unknown as Event;
    const onChevronClick = (
      el as unknown as {
        onChevronClick(e: Event, i: ItemInstance<LibraryTreeNode>): void;
      }
    ).onChevronClick.bind(el);

    onChevronClick(event, item);
    expect(stopped).toBe(true);
    expect(item.isExpanded()).toBe(true);
    expect(selected).toEqual([]);

    onChevronClick(event, item);
    expect(item.isExpanded()).toBe(false);
    expect(selected).toEqual([]);
  });

  it("double-clicking a package neither opens nor toggles its expansion", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Modelica");
    expect(item.isExpanded()).toBe(false);
    const selected = onSelect(el);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(selected).toEqual([]);
    expect(item.isExpanded()).toBe(false);
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

  it("search row: Enter opens an openable class, Space selects, and a package never opens", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const opened = onSelect(el);
    const priv = el as unknown as {
      onSearchRowKeydown(
        e: KeyboardEvent,
        className: string,
        restriction: LibraryClassRestriction,
      ): void;
      selectedClassName: string | null;
    };
    // `<lit-virtualizer>` doesn't render search rows under happy-dom; drive the
    // keyboard handler directly to pin the open (Enter) vs. select (Space) split
    // and the package gate.
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: " " }),
      "Modelica.Blocks",
      "package",
    );
    expect(priv.selectedClassName).toBe("Modelica.Blocks");
    expect(opened).toEqual([]);

    // Enter on a package must not open — opening a package as a diagram wedges
    // the view.
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Modelica.Blocks",
      "package",
    );
    expect(opened).toEqual([]);

    // Enter on an openable class opens it.
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Modelica.Blocks.Math.Gain",
      "block",
    );
    expect(opened).toEqual(["Modelica.Blocks.Math.Gain"]);
  });
});
