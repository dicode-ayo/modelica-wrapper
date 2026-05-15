/**
 * Browser entry point for the diagram webview. Bundled by esbuild into
 * `out/webview.js` and loaded inside the VSCode webview iframe.
 *
 * The script:
 *   1. Defines the `<om-*>` custom elements by importing diagram-ui.
 *   2. Mounts `<om-graphical-layout>` for the actual diagram, plus the
 *      floating `<om-action-panel>` (Check / Simulate / Parameters) and
 *      a modal `<om-parameter-panel>` driven by extension messages.
 *   3. Acquires the VSCode webview API (`acquireVsCodeApi`), sends
 *      `{ type: "ready" }`, then routes DOM events from each custom
 *      element to the extension as protocol messages — and routes
 *      incoming messages back into the elements' state.
 */

import "@modelica-wrapper/diagram-ui";
import type {
  DiagramLayout,
  JsonSchema,
} from "@modelica-wrapper/omc-client";
import type {
  OmActionPanel,
  OmParameterPanel,
  ParameterFormSubmitDetail,
} from "@modelica-wrapper/diagram-ui";

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

/** Tracks the `kind` of the currently-open parameter modal — needed so
 *  cancel / submit messages can echo it back, letting the extension
 *  route the result to the right command flow. */
let activeParameterKind: string | null = null;

interface DomBindings {
  layout: HTMLElement;
  actionPanel: OmActionPanel;
  parameterPanel: OmParameterPanel;
}

function ensureDom(): DomBindings {
  let layout = document.getElementById("om-root") as HTMLElement | null;
  if (!layout) {
    layout = document.createElement("om-graphical-layout") as HTMLElement;
    layout.id = "om-root";
    layout.style.position = "absolute";
    layout.style.inset = "0";
    document.body.style.margin = "0";
    document.body.style.height = "100vh";
    document.body.appendChild(layout);
  }
  let actionPanel = document.getElementById("om-action-panel") as
    | OmActionPanel
    | null;
  if (!actionPanel) {
    actionPanel = document.createElement(
      "om-action-panel",
    ) as OmActionPanel;
    actionPanel.id = "om-action-panel";
    actionPanel.setAttribute("anchor", "top-right");
    document.body.appendChild(actionPanel);
  }
  let parameterPanel = document.getElementById("om-parameter-panel") as
    | OmParameterPanel
    | null;
  if (!parameterPanel) {
    parameterPanel = document.createElement(
      "om-parameter-panel",
    ) as OmParameterPanel;
    parameterPanel.id = "om-parameter-panel";
    document.body.appendChild(parameterPanel);
  }
  return { layout, actionPanel, parameterPanel };
}

function bindLayout(root: HTMLElement, layout: DiagramLayout): void {
  (root as unknown as { layout: DiagramLayout }).layout = layout;
}

function wireLayoutEvents(root: HTMLElement): void {
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

function wireActionPanel(panel: OmActionPanel): void {
  panel.addEventListener("om-action-check", () =>
    post({ type: "actionCheck" }),
  );
  panel.addEventListener("om-action-simulate", () =>
    post({ type: "actionSimulate" }),
  );
  panel.addEventListener("om-action-parameters", () =>
    post({ type: "actionParameters" }),
  );
}

function wireParameterPanel(panel: OmParameterPanel): void {
  panel.addEventListener("om-panel-submit", (e) => {
    const detail = (e as CustomEvent<ParameterFormSubmitDetail>).detail;
    if (activeParameterKind === null) return;
    post({
      type: "parametersSubmit",
      kind: activeParameterKind,
      values: detail.values,
    });
  });
  panel.addEventListener("om-panel-cancel", () => {
    if (activeParameterKind === null) return;
    const kind = activeParameterKind;
    // Close locally — the extension will not echo a close for cancels.
    panel.open = false;
    activeParameterKind = null;
    post({ type: "parametersCancel", kind });
  });
}

function openParameterPanel(
  panel: OmParameterPanel,
  kind: string,
  schema: JsonSchema,
  values: Record<string, unknown>,
  title: string,
  submitLabel: string | undefined,
): void {
  panel.schema = schema;
  panel.values = values;
  panel.title = title;
  if (submitLabel !== undefined) {
    panel.submitLabel = submitLabel;
  }
  activeParameterKind = kind;
  panel.open = true;
}

function closeParameterPanel(panel: OmParameterPanel): void {
  panel.open = false;
  activeParameterKind = null;
}

function handle(
  message: ExtensionToWebview,
  dom: DomBindings,
): void {
  switch (message.type) {
    case "init":
    case "layout":
      bindLayout(dom.layout, message.layout);
      return;
    case "error":
      console.error("[diagram-ui] backend error:", message.message);
      return;
    case "parametersOpen":
      openParameterPanel(
        dom.parameterPanel,
        message.kind,
        message.schema,
        message.values,
        message.title,
        message.submitLabel,
      );
      return;
    case "parametersClose":
      closeParameterPanel(dom.parameterPanel);
      return;
  }
}

// Mount before the first init so event wiring is in place.
const dom = ensureDom();
wireLayoutEvents(dom.layout);
wireActionPanel(dom.actionPanel);
wireParameterPanel(dom.parameterPanel);

window.addEventListener("message", (e) => {
  const data = e.data as ExtensionToWebview | undefined;
  if (data && typeof data === "object" && "type" in data) {
    handle(data, dom);
  }
});

post({ type: "ready" });
