/**
 * Docked library palette on `<om-graphical-layout>`. The palette hosts
 * `<om-library-tree>` as an in-canvas drag source for the same classes the
 * double-click library browser lists, fed by the SAME `libraryDataSource`.
 * These pin the wiring, not the happy path: the palette is gated on a data
 * source, the show/collapse toggle flips the tree's visibility, and the tree
 * receives the source object itself (one data path, not a copy).
 *
 * happy-dom can't render `<lit-virtualizer>`, so the source's `listChildren`
 * resolves empty — the tree mounts but stays in its loading placeholder. The
 * assertions read the structural layer (element presence + forwarded prop).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import "./graphical-layout.component.js";
import type { OmGraphicalLayout } from "./graphical-layout.component.js";
import type { OmLibraryTree } from "../library-tree/library-tree.component.js";
import type { LibraryBrowserDataSource } from "../library-browser/library-browser.component.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

function emptyLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Test",
    source: {
      filename: "Test.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    classes: {},
    components: {},
    connectors: {},
    connections: [],
    labels: [],
    iconLayers: [],
    diagramLayers: [],
  };
}

/** Inert source: an empty root leaves the tree in its loading placeholder so
 *  no `<lit-virtualizer>` mounts under happy-dom. */
function stubSource(): LibraryBrowserDataSource {
  return {
    async listChildren() {
      return [];
    },
    async searchAll() {
      return [];
    },
  };
}

async function mount(opts: {
  source: LibraryBrowserDataSource | null;
  showPalette?: boolean;
}): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.rendererFactory = () => null;
  el.layout = emptyLayout();
  el.libraryDataSource = opts.source;
  if (opts.showPalette) {
    el.showPalette = true;
  }
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  return el;
}

const paletteTree = (el: OmGraphicalLayout): OmLibraryTree | null =>
  el.shadowRoot?.querySelector("om-library-tree") ?? null;

// Query the toggles by their a11y label, not a class, so the assertions ride
// the accessible contract and survive a style rename.
const showRail = (el: OmGraphicalLayout): HTMLButtonElement | null =>
  el.shadowRoot?.querySelector('[aria-label="Show library palette"]') ?? null;
const collapseButton = (el: OmGraphicalLayout): HTMLButtonElement | null =>
  el.shadowRoot?.querySelector('[aria-label="Hide library palette"]') ?? null;

describe("<om-graphical-layout> library palette", () => {
  it("renders no palette when no data source is set", async () => {
    const el = await mount({ source: null, showPalette: true });
    expect(el.shadowRoot?.querySelector(".palette")).toBeNull();
    expect(showRail(el)).toBeNull();
    expect(paletteTree(el)).toBeNull();
  });

  it("collapses to a show-rail (no tree) when a source is set but the palette is hidden", async () => {
    const el = await mount({ source: stubSource() });
    expect(showRail(el)).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".palette")).toBeNull();
    expect(paletteTree(el)).toBeNull();
  });

  it("mounts the tree when shown and forwards the same data source object", async () => {
    const source = stubSource();
    const el = await mount({ source, showPalette: true });
    const tree = paletteTree(el);
    expect(tree).not.toBeNull();
    expect(showRail(el)).toBeNull();
    // Same object, not a second data path.
    expect(tree?.dataSource).toBe(source);
  });

  it("flips tree visibility when the toggle is clicked either way", async () => {
    const el = await mount({ source: stubSource() });
    expect(paletteTree(el)).toBeNull();

    const rail = showRail(el);
    if (!rail) {
      throw new Error("show-rail missing");
    }
    rail.click();
    await el.updateComplete;
    expect(el.showPalette).toBe(true);
    expect(paletteTree(el)).not.toBeNull();

    const collapse = collapseButton(el);
    if (!collapse) {
      throw new Error("collapse button missing");
    }
    collapse.click();
    await el.updateComplete;
    expect(el.showPalette).toBe(false);
    expect(paletteTree(el)).toBeNull();
  });
});
