import { afterEach, describe, expect, it } from "vitest";
import { render, type TemplateResult } from "lit";
import type { ItemInstance, TreeInstance } from "@headless-tree/core";

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

  it("invalidateChildren re-lists only the target node and keeps the tree instance", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    treeOf(el).getItemInstance("Modelica").expand();
    await waitFor(() =>
      treeOf(el)
        .getItems()
        .some(
          (i: ItemInstance<LibraryTreeNode>) => i.getId() === "Modelica.Blocks",
        ),
    );
    const treeBefore = treeOf(el);
    listChildren.mockClear();

    // A class was created under Modelica; a targeted invalidation picks it up.
    const original = FAKE_TREE["Modelica"];
    FAKE_TREE["Modelica"] = [
      { qualified: "Modelica.Blocks", restriction: "package" },
      { qualified: "Modelica.Units", restriction: "package" },
    ];
    teardowns.push(() => {
      if (original) FAKE_TREE["Modelica"] = original;
    });

    el.invalidateChildren("Modelica");
    await waitFor(() =>
      treeOf(el)
        .getItems()
        .some(
          (i: ItemInstance<LibraryTreeNode>) => i.getId() === "Modelica.Units",
        ),
    );

    expect(listChildren).toHaveBeenCalledWith("Modelica");
    expect(listChildren).not.toHaveBeenCalledWith(null);
    // Same tree instance — expansion state survived, no wholesale rebuild.
    expect(treeOf(el)).toBe(treeBefore);
    expect(
      treeOf(el)
        .getItems()
        .some(
          (i: ItemInstance<LibraryTreeNode>) => i.getId() === "Modelica.Blocks",
        ),
    ).toBe(true);
  });

  it("invalidateChildren(null) re-lists the root without dropping the tree", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const treeBefore = treeOf(el);
    listChildren.mockClear();

    el.invalidateChildren(null);
    await waitFor(() => listChildren.mock.calls.length > 0);

    expect(listChildren).toHaveBeenCalledWith(null);
    expect(treeOf(el)).toBe(treeBefore);
  });

  it("invalidateChildren skips a parent the tree has never listed", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    listChildren.mockClear();

    el.invalidateChildren("Modelica.Blocks.Math");
    await flush();

    expect(listChildren).not.toHaveBeenCalled();
  });

  it("invalidateChildren skips a visible but never-expanded parent", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    // "Modelica" is a root row, but its children were never listed — a
    // targeted invalidation must not trigger an eager fetch for it.
    await waitFor(() => treeOf(el).getItems().length >= 2);
    listChildren.mockClear();

    el.invalidateChildren("Modelica");
    await flush();

    expect(listChildren).not.toHaveBeenCalled();
  });

  it("invalidateChildren preserves the typed search query", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const input = el.shadowRoot?.querySelector("input");
    if (!input) throw new Error("no search input");
    input.value = "gain";
    input.dispatchEvent(new Event("input"));
    await waitFor(
      () =>
        (el as unknown as { searchResults: unknown[] | null }).searchResults !==
        null,
    );

    el.invalidateChildren(null);
    await flush();

    expect(input.value).toBe("gain");
    expect(
      (el as unknown as { searchResults: unknown[] | null }).searchResults,
    ).not.toBeNull();
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
      activate(c: string, r: SearchTreeRow["restriction"]): void;
      selectedClassName: string | null;
      searchLoading: boolean;
    };
    const opened = onSelect(el);

    // Filtered-row interaction is keyed by className — no Headless Tree item.
    priv.onSearchRowClick(leaf.qualified); // single click selects
    expect(priv.selectedClassName).toBe(leaf.qualified);
    expect(opened).toEqual([]);
    priv.activate(leaf.qualified, leaf.restriction); // double click / Enter opens
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

  function onSelectDetails(el: OmLibraryTree): LibrarySelectDetail[] {
    const details: LibrarySelectDetail[] = [];
    el.addEventListener("om-library-select", (e) => {
      details.push((e as CustomEvent<LibrarySelectDetail>).detail);
    });
    return details;
  }

  /** Render a row template into a detached container and return its `.row`
   *  element, so click / dblclick / contextmenu bindings can be exercised (the
   *  virtualizer doesn't mount rows under happy-dom). */
  function renderIntoContainer(build: () => unknown): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    teardowns.push(() => container.remove());
    render(build() as never, container);
    const row = container.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("row not rendered");
    return row;
  }

  function renderRowEl(
    el: OmLibraryTree,
    item: ItemInstance<LibraryTreeNode>,
  ): HTMLElement {
    const renderRow = (
      el as unknown as {
        renderRow(i: ItemInstance<LibraryTreeNode>): unknown;
      }
    ).renderRow.bind(el);
    return renderIntoContainer(() => renderRow(item));
  }

  function renderSearchRowEl(
    el: OmLibraryTree,
    row: SearchTreeRow,
  ): HTMLElement {
    const renderSearchTreeRow = (
      el as unknown as {
        renderSearchTreeRow(r: SearchTreeRow): unknown;
      }
    ).renderSearchTreeRow.bind(el);
    return renderIntoContainer(() => renderSearchTreeRow(row));
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

  it("suppresses the native menu on a loading placeholder row without emitting", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    const events: LibraryContextMenuDetail[] = [];
    el.addEventListener("om-library-context-menu", (e) =>
      events.push((e as CustomEvent<LibraryContextMenuDetail>).detail),
    );

    const onRowContextMenu = (
      el as unknown as {
        onRowContextMenu(
          e: MouseEvent,
          className: string,
          restriction: LibraryClassRestriction,
          displayName: string,
        ): void;
      }
    ).onRowContextMenu.bind(el);
    const event = new MouseEvent("contextmenu", { cancelable: true });
    onRowContextMenu(event, "", "unknown", "Loading…");

    expect(event.defaultPrevented).toBe(true);
    expect(events).toEqual([]);
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

  it("opens a model into the diagram view on keyboard activation (primaryAction)", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const details = onSelectDetails(el);
    treeOf(el).getItemInstance("Sine").primaryAction();
    expect(details).toEqual([{ className: "Sine", view: "diagram" }]);
  });

  it("routes every activation somewhere: package to documentation, record to source", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const details = onSelectDetails(el);
    treeOf(el).getItemInstance("Modelica").primaryAction();
    treeOf(el).getItemInstance("Complex").primaryAction();
    expect(details).toEqual([
      { className: "Modelica", view: "documentation" },
      { className: "Complex", view: "source" },
    ]);
  });

  it("opens a connector into the diagram view on activation", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const details = onSelectDetails(el);

    renderRowEl(el, treeOf(el).getItemInstance("Pin")).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(details).toEqual([{ className: "Pin", view: "diagram" }]);
  });

  it("does not activate a loading placeholder row (empty className)", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    const details = onSelectDetails(el);
    (
      el as unknown as {
        activate(c: string, r: LibraryClassRestriction): void;
      }
    ).activate("", "unknown");
    expect(details).toEqual([]);
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

  it("double click opens a model row into the diagram view", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Sine");
    const details = onSelectDetails(el);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(details).toEqual([{ className: "Sine", view: "diagram" }]);
  });

  it("double click routes a package row to documentation, never the diagram", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Modelica");
    const details = onSelectDetails(el);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(details).toEqual([{ className: "Modelica", view: "documentation" }]);
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

  it("double-clicking a package does not toggle its expansion", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Modelica");
    expect(item.isExpanded()).toBe(false);

    renderRowEl(el, item).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );

    expect(item.isExpanded()).toBe(false);
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

  it("search row: Enter activates per restriction, Space only selects", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const details = onSelectDetails(el);
    const priv = el as unknown as {
      onSearchRowKeydown(
        e: KeyboardEvent,
        className: string,
        restriction: LibraryClassRestriction,
      ): void;
      selectedClassName: string | null;
    };
    // `<lit-virtualizer>` doesn't render search rows under happy-dom; drive the
    // keyboard handler directly to pin the open (Enter) vs. select (Space)
    // split and the per-restriction routing.
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: " " }),
      "Modelica.Blocks",
      "package",
    );
    expect(priv.selectedClassName).toBe("Modelica.Blocks");
    expect(details).toEqual([]);

    // Enter on a package routes to documentation — never the diagram, which a
    // package would wedge.
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Modelica.Blocks",
      "package",
    );
    // Enter on a connector opens its diagram.
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Modelica.Electrical.Analog.Interfaces.Pin",
      "connector",
    );
    priv.onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Modelica.Blocks.Math.Gain",
      "block",
    );
    expect(details).toEqual([
      { className: "Modelica.Blocks", view: "documentation" },
      {
        className: "Modelica.Electrical.Analog.Interfaces.Pin",
        view: "diagram",
      },
      { className: "Modelica.Blocks.Math.Gain", view: "diagram" },
    ]);
  });

  it("search rows and tree rows route an activation identically", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    const details = onSelectDetails(el);
    // Same class through the tree's primaryAction and the search row's Enter
    // handler — both surfaces go through the one `activate` path.
    treeOf(el).getItemInstance("Pin").primaryAction();
    (
      el as unknown as {
        onSearchRowKeydown(
          e: KeyboardEvent,
          className: string,
          restriction: LibraryClassRestriction,
        ): void;
      }
    ).onSearchRowKeydown(
      new KeyboardEvent("keydown", { key: "Enter" }),
      "Pin",
      "connector",
    );

    expect(details).toHaveLength(2);
    expect(details[0]).toEqual(details[1]);
    expect(details[0]).toEqual({ className: "Pin", view: "diagram" });
  });

  it("shows an optimistic chevron on a non-package class before its children are known", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    // "Resistor" and "Sine" are `model`s, not `package`s — before #345 these
    // never showed a chevron at all, regardless of whether they had children.
    expect(treeOf(el).getItemInstance("Resistor").isFolder()).toBe(true);
    expect(treeOf(el).getItemInstance("Sine").isFolder()).toBe(true);
  });

  it("expands a model to reveal its nested classes, not just a package", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);

    treeOf(el).getItemInstance("Resistor").expand();
    await waitFor(() =>
      treeOf(el)
        .getItems()
        .some(
          (i: ItemInstance<LibraryTreeNode>) => i.getId() === "Resistor.Inner",
        ),
    );

    expect(listChildren).toHaveBeenCalledWith("Resistor");
    expect(treeOf(el).getItemInstance("Resistor").isFolder()).toBe(true);
  });

  it("collapses a model to a leaf once its first expand comes back empty", async () => {
    const { source } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Sine");

    item.expand();

    // "Sine" has no listChildren entry (an empty result) — the optimistic
    // chevron shown before expansion must not linger on a genuine leaf.
    await waitFor(() => item.isFolder() === false);
  });

  it("re-expands a leaf once invalidateChildren finds children after all", async () => {
    const { source, listChildren } = makeSource();
    const el = await mount(source);
    await waitFor(() => treeOf(el).getItems().length >= 2);
    const item = treeOf(el).getItemInstance("Sine");

    item.expand();
    await waitFor(() => item.isFolder() === false);
    listChildren.mockClear();

    // A class was nested under a previously-empty model and re-listed (e.g.
    // via the .mo file watcher) — the collapsed leaf must re-expand, not
    // stay stuck as a leaf forever.
    const original = FAKE_TREE["Sine"];
    FAKE_TREE["Sine"] = [{ qualified: "Sine.Inner", restriction: "model" }];
    teardowns.push(() => {
      if (original) FAKE_TREE["Sine"] = original;
      else delete FAKE_TREE["Sine"];
    });

    el.invalidateChildren("Sine");
    await waitFor(() => item.isFolder() === true);

    expect(listChildren).toHaveBeenCalledWith("Sine");
  });
});
