import {
  formatComponentKey,
  formatConnectorKey,
} from "@dicode/diagram-ui/entity-keys";
import type { ParameterModel } from "@dicode/omc-client";
import { describe, expect, it, vi } from "vitest";

import "./webview-entry.js";
import type { ExtensionToWebview, WebviewToExtension } from "./protocol.js";
import {
  installVsCodeApi,
  mountRoot,
  postFromHost,
  rendered,
} from "./vscode-api.fixture.js";

const host = installVsCodeApi<WebviewToExtension, ExtensionToWebview>();

type Root = HTMLElementTagNameMap["om-webview-root"];

const MODEL: ParameterModel = { className: "P.R", fields: [] };

const mount = () => mountRoot("om-webview-root");

function child<K extends keyof HTMLElementTagNameMap>(
  root: Root,
  tag: K,
): HTMLElementTagNameMap[K] {
  return rendered(root.shadowRoot, tag);
}

/** What the host was sent, minus the focus reports an opening panel makes on
 *  its own as it moves focus into its first field. */
function sent(): WebviewToExtension[] {
  return host.posted.filter((m) => m.type !== "inputFocus");
}

describe("<om-webview-root>", () => {
  it("posts ready once it is connected", async () => {
    await mount();
    expect(host.posted).toEqual([{ type: "ready" }]);
  });

  it("drops a host message whose type it does not know", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await mount();
    host.clear();
    postFromHost({ type: "notAMessage" });
    await root.updateComplete;
    expect(warn).toHaveBeenCalledOnce();
    expect(host.posted).toEqual([]);
    expect(
      root.shadowRoot?.querySelector("om-graphical-layout"),
    ).not.toBeNull();
  });

  it("swaps the diagram for an error state on renderError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const root = await mount();
    await host.fromHost(root, {
      type: "renderError",
      className: "P.Broken",
      mode: "diagram",
      detail: "not fully loaded",
    });
    expect(root.shadowRoot?.querySelector("om-graphical-layout")).toBeNull();
    const error = child(root, "om-error-state");
    expect(error.subject).toBe("P.Broken");
    expect(error.detail).toBe("not fully loaded");
  });

  describe("parameter modal", () => {
    async function openComponentParams() {
      const root = await mount();
      host.clear();
      await host.fromHost(root, {
        type: "parametersOpen",
        kind: "componentParams",
        model: MODEL,
        title: "R1",
        crefPrefix: "R1",
      });
      return root;
    }

    it("offers reset only for a component's parameters", async () => {
      const root = await openComponentParams();
      const panel = child(root, "om-parameter-panel");
      expect(panel.open).toBe(true);
      expect(panel.showReset).toBe(true);

      await host.fromHost(root, {
        type: "parametersOpen",
        kind: "classParams",
        model: MODEL,
        title: "P.R",
      });
      expect(panel.showReset).toBe(false);
    });

    it("resets the component the modal was opened for", async () => {
      const root = await openComponentParams();
      child(root, "om-parameter-panel").dispatchEvent(
        new CustomEvent("om-panel-reset"),
      );
      expect(sent()).toEqual([
        { type: "resetComponentParameters", componentName: "R1" },
      ]);
    });

    it("closes locally on cancel and tells the host which form it was", async () => {
      const root = await openComponentParams();
      const panel = child(root, "om-parameter-panel");
      panel.dispatchEvent(new CustomEvent("om-panel-cancel"));
      await root.updateComplete;
      expect(panel.open).toBe(false);
      expect(sent()).toEqual([
        { type: "parametersCancel", kind: "componentParams" },
      ]);

      // With the modal closed there is no form to cancel or reset.
      panel.dispatchEvent(new CustomEvent("om-panel-cancel"));
      panel.dispatchEvent(new CustomEvent("om-panel-reset"));
      expect(sent()).toHaveLength(1);
    });
  });

  it("opens the editor of a double-clicked component and ignores a connector", async () => {
    const root = await mount();
    host.clear();
    const diagram = child(root, "om-graphical-layout");
    diagram.dispatchEvent(
      new CustomEvent("om-double-click", {
        detail: { key: formatConnectorKey("R1", "p") },
      }),
    );
    diagram.dispatchEvent(
      new CustomEvent("om-double-click", {
        detail: { key: formatComponentKey("R1") },
      }),
    );
    expect(host.posted).toEqual([
      { type: "editComponent", componentName: "R1" },
    ]);
  });

  it("relays a copy with its keys and a paste without", async () => {
    const root = await mount();
    host.clear();
    const diagram = child(root, "om-graphical-layout");
    const keys = [formatComponentKey("R1")];
    diagram.dispatchEvent(
      new CustomEvent("om-clipboard-request", {
        detail: { action: "copy", keys },
      }),
    );
    diagram.dispatchEvent(
      new CustomEvent("om-clipboard-request", { detail: { action: "paste" } }),
    );
    expect(host.posted).toEqual([
      { type: "copySelection", keys },
      { type: "paste" },
    ]);
  });
});
