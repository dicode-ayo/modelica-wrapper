import { describe, expect, it, vi } from "vitest";

import type { LibraryDataSource, LibraryClassInfo } from "./library-types.js";
import {
  LIBRARY_TREE_ROOT_ID,
  createLibraryDataLoader,
  isExpandable,
  leafLabel,
  matchLabel,
  nodeFromInfo,
  rootNode,
  type LibraryTreeNode,
  isPlaceableRestriction,
  isOpenableRestriction,
} from "./library-tree-model.js";

function source(overrides: Partial<LibraryDataSource> = {}): LibraryDataSource {
  return {
    listChildren: vi.fn(async () => []),
    searchAll: vi.fn(async () => []),
    ...overrides,
  };
}

describe("isExpandable", () => {
  it("is optimistic while hasChildren is unresolved, regardless of restriction", () => {
    expect(isExpandable({})).toBe(true);
  });

  it("expands once hasChildren is confirmed true", () => {
    expect(isExpandable({ hasChildren: true })).toBe(true);
  });

  it("collapses to a leaf once hasChildren is confirmed false", () => {
    expect(isExpandable({ hasChildren: false })).toBe(false);
  });
});

describe("leafLabel", () => {
  it("returns the trailing dotted segment", () => {
    expect(leafLabel("Modelica.Blocks.Math.Gain")).toBe("Gain");
    expect(leafLabel("Complex")).toBe("Complex");
  });

  it("does not split inside a quoted identifier containing a dot", () => {
    // `'a.b'` is a single Q-IDENT segment (Modelica spec §2.3.1); the
    // trailing label is the whole quoted segment, not `b'`.
    expect(leafLabel("Pkg.'a.b'")).toBe("'a.b'");
  });

  it("falls back to the whole name for a trailing dot", () => {
    expect(leafLabel("Pkg.")).toBe("Pkg.");
  });
});

describe("nodeFromInfo", () => {
  it("builds a node with className, leaf label, and restriction", () => {
    const info: LibraryClassInfo = {
      qualified: "Modelica.Blocks.Math.Gain",
      restriction: "block",
    };
    expect(nodeFromInfo(info)).toEqual({
      className: "Modelica.Blocks.Math.Gain",
      label: "Gain",
      restriction: "block",
    });
  });
});

describe("createLibraryDataLoader", () => {
  it("maps the synthetic root id to listChildren(null)", async () => {
    const listChildren = vi.fn(async () => [
      { qualified: "Modelica", restriction: "package" } as LibraryClassInfo,
    ]);
    const cache = new Map<string, LibraryTreeNode>();
    const loader = createLibraryDataLoader(source({ listChildren }), cache);

    const children = await loader.getChildrenWithData(LIBRARY_TREE_ROOT_ID);

    expect(listChildren).toHaveBeenCalledWith(null);
    expect(children).toEqual([
      {
        id: "Modelica",
        data: nodeFromInfo({ qualified: "Modelica", restriction: "package" }),
      },
    ]);
  });

  it("lists a parent's children by its own id and caches them", async () => {
    const listChildren = vi.fn(async () => [
      {
        qualified: "Modelica.Blocks",
        restriction: "package",
      } as LibraryClassInfo,
    ]);
    const cache = new Map<string, LibraryTreeNode>();
    const loader = createLibraryDataLoader(source({ listChildren }), cache);

    await loader.getChildrenWithData("Modelica");

    expect(listChildren).toHaveBeenCalledWith("Modelica");
    expect(cache.get("Modelica.Blocks")).toEqual({
      className: "Modelica.Blocks",
      label: "Blocks",
      restriction: "package",
    });
  });

  it("prefixes bare child names with the parent path", async () => {
    const listChildren = vi.fn(async () => [
      { qualified: "Gain", restriction: "block" } as LibraryClassInfo,
    ]);
    const cache = new Map<string, LibraryTreeNode>();
    const loader = createLibraryDataLoader(source({ listChildren }), cache);

    const [child] = await loader.getChildrenWithData("Modelica.Blocks.Math");

    expect(child?.id).toBe("Modelica.Blocks.Math.Gain");
  });

  it("resolves the root node and cached / fallback items via getItem", async () => {
    const cache = new Map<string, LibraryTreeNode>();
    const loader = createLibraryDataLoader(source(), cache);
    cache.set("Modelica", {
      className: "Modelica",
      label: "Modelica",
      restriction: "package",
    });

    expect(loader.getItem(LIBRARY_TREE_ROOT_ID)).toEqual(rootNode());
    expect(loader.getItem("Modelica").restriction).toBe("package");
    expect(loader.getItem("Not.Listed")).toEqual({
      className: "Not.Listed",
      label: "Listed",
      restriction: "unknown",
    });
  });

  it("reports the root load outcome via onRootLoad (ready)", async () => {
    const onRootLoad = vi.fn();
    const listChildren = vi.fn(async () => [
      { qualified: "Modelica", restriction: "package" } as LibraryClassInfo,
    ]);
    const loader = createLibraryDataLoader(
      source({ listChildren }),
      new Map(),
      onRootLoad,
    );

    await loader.getChildrenWithData(LIBRARY_TREE_ROOT_ID);
    expect(onRootLoad).toHaveBeenCalledWith({ ok: true, empty: false });
  });

  it("reports an empty root and does not fire onRootLoad for non-root loads", async () => {
    const onRootLoad = vi.fn();
    const loader = createLibraryDataLoader(source(), new Map(), onRootLoad);

    await loader.getChildrenWithData(LIBRARY_TREE_ROOT_ID);
    expect(onRootLoad).toHaveBeenCalledWith({ ok: true, empty: true });

    onRootLoad.mockClear();
    await loader.getChildrenWithData("Modelica");
    expect(onRootLoad).not.toHaveBeenCalled();
  });

  it("reports a root load failure via onRootLoad and rethrows", async () => {
    const onRootLoad = vi.fn();
    const listChildren = vi.fn(async () => {
      throw new Error("Socket is busy writing");
    });
    const loader = createLibraryDataLoader(
      source({ listChildren }),
      new Map(),
      onRootLoad,
    );

    await expect(
      loader.getChildrenWithData(LIBRARY_TREE_ROOT_ID),
    ).rejects.toThrow("Socket is busy writing");
    expect(onRootLoad).toHaveBeenCalledWith({
      ok: false,
      error: "Socket is busy writing",
    });
  });
});

describe("matchLabel", () => {
  it("splits a label around a case-insensitive match", () => {
    expect(matchLabel("Integrator", "gra")).toEqual({
      before: "Inte",
      match: "gra",
      after: "tor",
    });
  });

  it("returns null when the query is empty or absent", () => {
    expect(matchLabel("Gain", "")).toBeNull();
    expect(matchLabel("Gain", "xyz")).toBeNull();
  });
});

describe("restriction gates", () => {
  // OMEdit's GraphicsView::addComponent accepts exactly these on a diagram.
  const placeable = [
    "class",
    "model",
    "block",
    "connector",
    "expandable connector",
    "record",
  ] as const;
  const notPlaceable = [
    "package",
    "function",
    "type",
    "operator",
    "operator function",
    "operator record",
    "unknown",
  ] as const;

  it.each(placeable)("%s can be placed on a diagram", (r) => {
    expect(isPlaceableRestriction(r)).toBe(true);
  });

  it.each(notPlaceable)("%s cannot be placed on a diagram", (r) => {
    expect(isPlaceableRestriction(r)).toBe(false);
  });

  // Opening is narrower: a connector is placeable but has no diagram.
  it.each(["class", "model", "block"] as const)("%s has a diagram", (r) => {
    expect(isOpenableRestriction(r)).toBe(true);
  });

  it.each(["connector", "expandable connector", "record", "package"] as const)(
    "%s has no diagram to open",
    (r) => {
      expect(isOpenableRestriction(r)).toBe(false);
    },
  );

  it("every openable restriction is also placeable", () => {
    for (const r of [...placeable, ...notPlaceable]) {
      if (isOpenableRestriction(r)) {
        expect(isPlaceableRestriction(r)).toBe(true);
      }
    }
  });
});
