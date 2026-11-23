import type { LibraryContextMenuDetail } from "@dicode/diagram-ui";
import { describe, expect, it } from "vitest";

import "./library-view-entry.js";
import type { LibraryRequestMessage } from "./library-messages.js";
import type {
  ExtensionToLibraryView,
  LibraryViewToExtension,
} from "./library-view-protocol.js";
import { installVsCodeApi, mountRoot, rendered } from "./vscode-api.fixture.js";

const host = installVsCodeApi<LibraryViewToExtension, ExtensionToLibraryView>();

type Root = HTMLElementTagNameMap["om-library-view-root"];

const mount = () => mountRoot("om-library-view-root");

/** Lets the tree's data-loader promises and the re-render they cause settle. */
async function settle(root: Root): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await root.updateComplete;
}

function rootListRequest(): Extract<
  LibraryRequestMessage,
  { type: "libraryListChildren" }
> {
  const req = host.posted.find(
    (m) => m.type === "libraryListChildren" && m.parent === null,
  );
  if (req?.type !== "libraryListChildren") {
    throw new Error("expected the tree to request the top-level list");
  }
  return req;
}

async function answerRoot(
  root: Root,
  response: Omit<
    Extract<ExtensionToLibraryView, { type: "libraryChildren" }>,
    "type" | "requestId"
  >,
): Promise<void> {
  await settle(root);
  await host.fromHost(root, {
    type: "libraryChildren",
    requestId: rootListRequest().requestId,
    ...response,
  });
  await settle(root);
}

const DATA_TRAFFIC = new Set<string>([
  "libraryListChildren",
  "librarySearch",
  "libraryIcon",
  "libraryCancel",
] satisfies LibraryRequestMessage["type"][]);

/** Messages other than the tree's own data traffic. */
function sent(): LibraryViewToExtension[] {
  return host.posted.filter((m) => !DATA_TRAFFIC.has(m.type));
}

function shadow(root: Root): ShadowRoot {
  const sr = root.shadowRoot;
  if (!sr) throw new Error("expected an open shadow root");
  return sr;
}

const tree = (root: Root) => rendered(root.shadowRoot, "om-library-tree");

describe("<om-library-view-root>", () => {
  it("routes the tree's top-level fetch through the host and shows the empty state", async () => {
    const root = await mount();
    await answerRoot(root, { items: [] });

    expect(shadow(root).querySelector("om-library-tree")).toBeNull();
    const load = shadow(root).querySelector<HTMLButtonElement>(".state button");
    expect(load?.textContent).toContain("Load Library");
    load?.click();
    expect(sent()).toEqual([{ type: "loadLibrary" }]);
  });

  it("falls back to a full reload when a re-list targets a view with no tree", async () => {
    const root = await mount();
    await answerRoot(root, { items: [] });
    expect(shadow(root).querySelector("om-library-tree")).toBeNull();

    await host.fromHost(root, {
      type: "libraryChildrenChanged",
      parent: null,
    });
    expect(shadow(root).querySelector("om-library-tree")).not.toBeNull();
  });

  it("shows the tree's load error and remounts the tree on retry", async () => {
    const root = await mount();
    tree(root).dispatchEvent(
      new CustomEvent("om-library-root-loaded", {
        detail: { ok: false, error: "omc is down" },
      }),
    );
    await root.updateComplete;

    expect(shadow(root).querySelector("om-library-tree")).toBeNull();
    expect(shadow(root).querySelector(".state.error")?.textContent).toContain(
      "omc is down",
    );
    shadow(root)
      .querySelector<HTMLButtonElement>(".state.error button")
      ?.click();
    await root.updateComplete;
    expect(shadow(root).querySelector(".state.error")).toBeNull();
    expect(shadow(root).querySelector("om-library-tree")).not.toBeNull();
  });

  const GAIN = "Modelica.Blocks.Math.Gain";

  function startPlacement(root: Root): void {
    tree(root).dispatchEvent(
      new CustomEvent("om-library-placement-start", {
        detail: { className: GAIN },
      }),
    );
  }

  it("cancels nothing on release when no placement was started", async () => {
    await mount();
    window.dispatchEvent(new Event("pointerup"));
    expect(sent()).toEqual([]);
  });

  it("cancels a started placement once on release", async () => {
    const root = await mount();
    startPlacement(root);
    window.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(new Event("pointerup"));
    expect(sent()).toEqual([
      { type: "placementStart", className: GAIN },
      { type: "placementCancel" },
    ]);
  });

  it("cancels a started placement once on Escape", async () => {
    const root = await mount();
    startPlacement(root);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(sent()).toEqual([
      { type: "placementStart", className: GAIN },
      { type: "placementCancel" },
    ]);
  });

  describe("row context menu", () => {
    function rightClick(root: Root, detail: LibraryContextMenuDetail) {
      tree(root).dispatchEvent(
        new CustomEvent("om-library-context-menu", { detail }),
      );
      return rendered(root.shadowRoot, "om-context-menu");
    }

    const PACKAGE_ROW: LibraryContextMenuDetail = {
      className: "Lib.Pkg",
      displayName: "Pkg",
      restriction: "package",
      x: 1,
      y: 2,
    };

    it("offers package actions only on a package row", async () => {
      const root = await mount();
      const ids = (detail: LibraryContextMenuDetail) =>
        rightClick(root, detail).items.map((i) => i.id);

      expect(ids(PACKAGE_ROW)).toEqual([
        "viewSource",
        "createClass",
        "savePackage",
      ]);
      expect(ids({ ...PACKAGE_ROW, restriction: "model" })).toEqual([
        "viewSource",
      ]);
      expect(ids({ ...PACKAGE_ROW, restriction: "unknown" })).toEqual([
        "viewSource",
      ]);
    });

    it("relays a chosen action against the row it was opened for", async () => {
      const root = await mount();
      const menu = rightClick(root, PACKAGE_ROW);
      menu.dispatchEvent(
        new CustomEvent("om-context-menu-select", {
          detail: { id: "createClass" },
        }),
      );
      // The row is consumed by the first selection.
      menu.dispatchEvent(
        new CustomEvent("om-context-menu-select", {
          detail: { id: "createClass" },
        }),
      );
      expect(sent()).toEqual([
        {
          type: "libraryNodeCommand",
          command: "createClass",
          node: {
            qualifiedName: "Lib.Pkg",
            displayName: "Pkg",
            restriction: "package",
          },
        },
      ]);
    });

    it("drops a selection that names no library command", async () => {
      const root = await mount();
      rightClick(root, PACKAGE_ROW).dispatchEvent(
        new CustomEvent("om-context-menu-select", {
          detail: { id: "notACommand" },
        }),
      );
      expect(sent()).toEqual([]);
    });
  });
});
