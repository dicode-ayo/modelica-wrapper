import { describe, expect, it, vi } from "vitest";

import "./postprocessing-entry.js";
import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "./postprocessing-protocol.js";
import {
  installVsCodeApi,
  mountRoot,
  postFromHost,
  rendered,
} from "./vscode-api.fixture.js";

const host = installVsCodeApi<WebviewToExtension, ExtensionToWebview>();

type Root = HTMLElementTagNameMap["om-result-view-root"];

const mount = () => mountRoot("om-result-view-root");
const app = (root: Root) => rendered(root.shadowRoot, "om-result-view-app");

describe("<om-result-view-root>", () => {
  it("posts ready once it is connected", async () => {
    await mount();
    expect(host.posted).toEqual([{ type: "ready" }]);
  });

  it("keeps each result's variables as later results' lists arrive", async () => {
    const root = await mount();
    await host.fromHost(root, {
      type: "variables",
      resultId: "a",
      vars: ["x"],
    });
    await host.fromHost(root, {
      type: "variables",
      resultId: "b",
      vars: ["y"],
    });
    expect(app(root).variablesByResult).toEqual({ a: ["x"], b: ["y"] });
  });

  it("surfaces a failure as the status line, and only a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const root = await mount();
    await host.fromHost(root, { type: "status", message: "read 3 results" });
    expect(app(root).statusMessage).toBeNull();

    await host.fromHost(root, {
      type: "variables",
      resultId: "a",
      error: "no file",
    });
    expect(app(root).statusMessage).toBe("no file");

    await host.fromHost(root, {
      type: "status",
      message: "bad mat",
      error: true,
    });
    expect(app(root).statusMessage).toBe("bad mat");
  });

  it("spins only for the plots area", async () => {
    const root = await mount();
    await host.fromHost(root, { type: "loading", area: "results", busy: true });
    expect(app(root).plotsLoading).toBe(false);
    await host.fromHost(root, { type: "loading", area: "plots", busy: true });
    expect(app(root).plotsLoading).toBe(true);
  });

  it("defaults trace data when a doc arrives without it", async () => {
    const root = await mount();
    const doc = { version: 1 as const, results: [], cards: [] };
    postFromHost({ type: "doc", doc });
    await root.updateComplete;
    expect(app(root).doc).toBe(doc);
    expect(app(root).traceData).toEqual({});
  });

  it("translates the app's events into host messages", async () => {
    const root = await mount();
    host.clear();
    const el = app(root);
    el.dispatchEvent(
      new CustomEvent("om-add-trace", {
        detail: { cardId: "c1", resultId: "r1", variable: "x" },
      }),
    );
    el.dispatchEvent(
      new CustomEvent("om-rename-result", {
        detail: { resultId: "r1", label: "baseline" },
      }),
    );
    el.dispatchEvent(
      new CustomEvent("om-remove-trace", {
        detail: { cardId: "c1", traceIndex: 0 },
      }),
    );
    expect(host.posted).toEqual([
      { type: "addTrace", cardId: "c1", resultId: "r1", variable: "x" },
      { type: "renameResult", resultId: "r1", label: "baseline" },
      { type: "removeTrace", cardId: "c1", traceIndex: 0 },
    ]);
  });
});
