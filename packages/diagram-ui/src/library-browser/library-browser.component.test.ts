import { afterEach, describe, expect, it, vi } from "vitest";

import "./library-browser.component.js";
import type {
  LibraryBrowserDataSource,
  LibraryCancelDetail,
  LibrarySelectDetail,
  OmLibraryBrowser,
} from "./library-browser.component.js";
import { makeFakeLibrarySource } from "../library-tree/library-tree.fixtures.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

// `<wa-dialog>` (and the `<wa-button>` it nests) reach for ElementInternals
// APIs happy-dom doesn't implement, so a connected+open browser never mounts
// cleanly under the test environment. The tests therefore assert the closed
// render through the real DOM and drive the select/cancel handlers directly —
// the same approach `library-tree.test.ts` takes for its virtualizer rows.

async function mountClosed(
  source: LibraryBrowserDataSource | null,
): Promise<OmLibraryBrowser> {
  const el = document.createElement("om-library-browser") as OmLibraryBrowser;
  el.dataSource = source;
  el.open = false;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  return el;
}

interface BrowserHandlers {
  onTreeSelect(e: CustomEvent<LibrarySelectDetail>): void;
  onDialogHide(e: Event): void;
}

function handlersOf(el: OmLibraryBrowser): BrowserHandlers {
  return el as unknown as BrowserHandlers;
}

describe("<om-library-browser>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-library-browser")).toBeDefined();
  });

  it("renders nothing while closed", async () => {
    const { source } = makeFakeLibrarySource();
    const el = await mountClosed(source);
    expect(el.shadowRoot?.querySelector("wa-dialog")).toBeNull();
    expect(el.shadowRoot?.querySelector("om-library-tree")).toBeNull();
  });

  it("forwards the tree's select as its own event, closes, and stops the tree's copy", () => {
    const el = document.createElement("om-library-browser") as OmLibraryBrowser;
    el.open = true;

    const selected: string[] = [];
    el.addEventListener("om-library-select", (e) => {
      selected.push((e as CustomEvent<LibrarySelectDetail>).detail.className);
    });

    const treeEvent = new CustomEvent<LibrarySelectDetail>(
      "om-library-select",
      {
        detail: { className: "Modelica.Blocks.Math.Gain" },
        bubbles: true,
        composed: true,
      },
    );
    const stop = vi.spyOn(treeEvent, "stopPropagation");
    handlersOf(el).onTreeSelect(treeEvent);

    // Re-emitted once (not the tree's own copy leaking through) and closed.
    expect(selected).toEqual(["Modelica.Blocks.Math.Gain"]);
    expect(stop).toHaveBeenCalledOnce();
    expect(el.open).toBe(false);
  });

  it("emits om-library-cancel and closes when the dialog hides", () => {
    const el = document.createElement("om-library-browser") as OmLibraryBrowser;
    el.open = true;

    let cancelled = 0;
    el.addEventListener("om-library-cancel", (e) => {
      expect((e as CustomEvent<LibraryCancelDetail>).detail).toBeNull();
      cancelled++;
    });

    handlersOf(el).onDialogHide(new Event("wa-hide"));

    expect(cancelled).toBe(1);
    expect(el.open).toBe(false);
  });

  it("does not re-fire om-library-cancel when the dialog is already closed", () => {
    const el = document.createElement("om-library-browser") as OmLibraryBrowser;
    el.open = false;

    let cancelled = 0;
    el.addEventListener("om-library-cancel", () => cancelled++);
    handlersOf(el).onDialogHide(new Event("wa-hide"));

    expect(cancelled).toBe(0);
  });
});
