/**
 * Browser entry point for the diagram webview. Bundled by esbuild into
 * `out/webview.js` and loaded inside the VSCode webview iframe.
 *
 * The script just registers a single `<om-webview-root>` Lit element —
 * the host page (`packages/extension/src/diagram/panel.ts`) drops the
 * tag straight into its body. All wiring (acquiring the VSCode API,
 * listening for host→webview messages, sending `ready`) lives in
 * `connectedCallback` so the element is self-contained.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import "@modelica-wrapper/diagram-ui";
import type {
  DiagramLayout,
  JsonSchema,
} from "@modelica-wrapper/omc-client";
import type { ParameterFormSubmitDetail } from "@modelica-wrapper/diagram-ui";

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

/**
 * Lazy singleton — `acquireVsCodeApi()` can only be called once per
 * webview, so cache the handle in module scope. Read at first use
 * (rather than at module load) so test bundles that import this file
 * without a `acquireVsCodeApi` shim don't crash on parse.
 */
let cachedApi: VsCodeApi | null = null;
function getVsCodeApi(): VsCodeApi {
  if (!cachedApi) {
    cachedApi = acquireVsCodeApi();
  }
  return cachedApi;
}

@customElement("om-webview-root")
class OmWebviewRoot extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
    }
    om-graphical-layout {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;

  @state() private layout: DiagramLayout | null = null;
  @state() private paramOpen = false;
  @state() private paramSchema: JsonSchema | undefined = undefined;
  @state() private paramValues: Record<string, unknown> = {};
  @state() private paramTitle = "";
  @state() private paramSubmitLabel = "Apply";

  /** Opaque tag the extension uses to route the modal's submit/cancel
   *  back to the right command flow. */
  private paramKind: string | null = null;

  private vscode: VsCodeApi | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.vscode = getVsCodeApi();
    window.addEventListener("message", this.onHostMessage);
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onHostMessage);
  }

  override render(): TemplateResult {
    return html`
      <om-graphical-layout
        .layout=${this.layout}
        ?perf-hud=${true}
        @om-graphical-layout-change=${this.onLayoutChange}
        @om-connection-create=${this.onConnectionCreate}
        @om-selection-change=${this.onSelectionChange}
      ></om-graphical-layout>
      <om-action-panel
        anchor="top-right"
        @om-action-check=${() => this.post({ type: "actionCheck" })}
        @om-action-simulate=${() => this.post({ type: "actionSimulate" })}
        @om-action-parameters=${() => this.post({ type: "actionParameters" })}
      ></om-action-panel>
      <om-parameter-panel
        ?open=${this.paramOpen}
        .schema=${this.paramSchema}
        .values=${this.paramValues}
        .title=${this.paramTitle}
        .submitLabel=${this.paramSubmitLabel}
        @om-panel-submit=${this.onParamSubmit}
        @om-panel-cancel=${this.onParamCancel}
      ></om-parameter-panel>
    `;
  }

  private readonly onHostMessage = (e: MessageEvent): void => {
    const data = e.data as ExtensionToWebview | undefined;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    this.apply(data);
  };

  private apply(message: ExtensionToWebview): void {
    switch (message.type) {
      case "init":
      case "layout":
        this.layout = message.layout;
        return;
      case "parametersOpen":
        this.paramSchema = message.schema;
        this.paramValues = message.values;
        this.paramTitle = message.title;
        this.paramSubmitLabel = message.submitLabel ?? "Apply";
        this.paramKind = message.kind;
        this.paramOpen = true;
        return;
      case "parametersClose":
        this.paramOpen = false;
        this.paramKind = null;
        return;
      case "error":
        console.error("[diagram-ui] backend error:", message.message);
        return;
    }
  }

  private post(msg: WebviewToExtension): void {
    this.vscode?.postMessage(msg);
  }

  private onLayoutChange = (e: Event): void => {
    const detail = (e as CustomEvent<DiagramLayout>).detail;
    this.post({ type: "change", layout: detail });
  };

  private onConnectionCreate = (e: Event): void => {
    const d = (e as CustomEvent<{ fromKey: string; toKey: string }>).detail;
    this.post({ type: "connectionCreate", fromKey: d.fromKey, toKey: d.toKey });
  };

  private onSelectionChange = (e: Event): void => {
    const d = (e as CustomEvent<{ keys: string[] }>).detail;
    this.post({ type: "selectionChange", keys: d.keys });
  };

  private onParamSubmit = (e: Event): void => {
    if (this.paramKind === null) return;
    const detail = (e as CustomEvent<ParameterFormSubmitDetail>).detail;
    this.post({
      type: "parametersSubmit",
      kind: this.paramKind,
      values: detail.values,
    });
  };

  private onParamCancel = (): void => {
    if (this.paramKind === null) return;
    const kind = this.paramKind;
    // Close locally — the extension does not echo a close for cancels.
    this.paramOpen = false;
    this.paramKind = null;
    this.post({ type: "parametersCancel", kind });
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "om-webview-root": OmWebviewRoot;
  }
}
