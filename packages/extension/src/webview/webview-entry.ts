/**
 * Browser entry point for the diagram webview. Bundled by esbuild into
 * `out/webview.js` and loaded inside the VSCode webview iframe.
 *
 * The script:
 *   1. Defines the `<om-*>` custom elements by importing diagram-ui.
 *   2. Acquires the VSCode webview API (`acquireVsCodeApi`).
 *   3. Sends `{ type: "ready" }` to the extension and listens for the
 *      first `{ type: "init", layout }` message.
 *   4. Mounts `<om-graphical-layout>` against the layout and forwards
 *      its DOM events to the extension as protocol messages.
 */

import "@modelica-wrapper/diagram-ui";
import type { DiagramLayout } from "@modelica-wrapper/omc-client";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "./protocol.js";

// Injected by esbuild `define`. Captures the build's wall-clock time so we
// can tell at a glance whether the iframe is running freshly-bundled JS.
declare const __WEBVIEW_BUILD_TIME__: string;

console.log(
  `[webview boot] build=${__WEBVIEW_BUILD_TIME__} loaded=${new Date().toISOString()}`,
);

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function post(message: WebviewToExtension): void {
  vscode.postMessage(message);
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById("om-root");
  if (!root) {
    root = document.createElement("om-graphical-layout");
    root.id = "om-root";
    root.style.position = "absolute";
    root.style.inset = "0";
    document.body.style.margin = "0";
    document.body.style.height = "100vh";
    document.body.appendChild(root);
  }
  return root;
}

function bindLayout(root: HTMLElement, layout: DiagramLayout): void {
  (root as unknown as { layout: DiagramLayout }).layout = layout;
}

function wireEvents(root: HTMLElement): void {
  root.addEventListener("om-graphical-layout-change", (e) => {
    const detail = (e as CustomEvent<DiagramLayout>).detail;
    post({ type: "change", layout: detail });
  });
  root.addEventListener("om-connection-create", (e) => {
    const d = (e as CustomEvent<{ fromKey: string; toKey: string }>).detail;
    post({ type: "connectionCreate", fromKey: d.fromKey, toKey: d.toKey });
  });
  root.addEventListener("om-selection-change", (e) => {
    const d = (e as CustomEvent<{ keys: string[] }>).detail;
    post({ type: "selectionChange", keys: d.keys });
  });
}

function handle(message: ExtensionToWebview): void {
  const root = ensureRoot();
  switch (message.type) {
    case "init":
    case "layout":
      bindLayout(root, message.layout);
      return;
    case "error":
      console.error("[diagram-ui] backend error:", message.message);
      return;
  }
}

window.addEventListener("message", (e) => {
  const data = e.data as ExtensionToWebview | undefined;
  if (data && typeof data === "object" && "type" in data) {
    handle(data);
  }
});

// Mount before the first init so event wiring is in place.
const root = ensureRoot();
wireEvents(root);

post({ type: "ready" });
