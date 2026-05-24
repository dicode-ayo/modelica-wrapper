/**
 * Browser entry point for the postprocessing webview. Bundled by esbuild into
 * `out/postprocessing.js` and loaded by `ResultViewEditorProvider`'s HTML, which
 * drops `<om-result-view-root>` into its body.
 *
 * `<om-result-view-root>` is the bridge: the only place that touches the VSCode
 * webview API. It mounts the `result-ui` app, sets its data from host messages,
 * and translates the components' DOM `CustomEvent`s into `postMessage`s.
 * `result-ui` itself never sees VSCode — it stays a pure renderer.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

// Boot Web Awesome's theme + the VSCode-token bridge (side-effect import). Also
// what makes esbuild emit `out/postprocessing.css`, which the host <link>s to.
import "@modelica-wrapper/ui-common/webawesome-setup";

// Side-effect import: registers <om-result-view-app> and its children.
import "@modelica-wrapper/result-ui";
import type {
  AddPlotDetail,
  AddResultDetail,
  AddTraceDetail,
  DeletePlotDetail,
  RemoveResultDetail,
  RemoveTraceDetail,
  RenameResultDetail,
  RequestVariablesDetail,
} from "@modelica-wrapper/result-ui";
// Type-only against omc-client: a value import would pull its Node-only runtime
// (`zeromq`, `node:*`) into this browser bundle.
import type { ResultViewDoc } from "@modelica-wrapper/omc-client";

import type {
  ExtensionToWebview,
  TracePayload,
  WebviewToExtension,
} from "./postprocessing-protocol.js";

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

@customElement("om-result-view-root")
export class OmResultViewRoot extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
  `;

  private readonly vscode = acquireVsCodeApi();

  // Defaults to the empty document (the same literal `<om-result-view-app>`
  // defaults to) so the themed app renders its own empty state during the
  // `ready` → `doc` round-trip — the shell never paints unstyled chrome.
  @state() private doc: ResultViewDoc = { version: 1, results: [], cards: [] };
  @state() private traceData: Record<string, TracePayload[]> = {};
  @state() private variablesByResult: Record<string, string[]> = {};
  @state() private plotsLoading = false;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.onMessage);
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onMessage);
  }

  private readonly onMessage = (e: MessageEvent<ExtensionToWebview>): void => {
    const msg = e.data;
    switch (msg.type) {
      case "doc":
        this.doc = msg.doc;
        this.traceData = msg.traceData ?? {};
        return;
      case "variables":
        if (msg.vars) {
          this.variablesByResult = {
            ...this.variablesByResult,
            [msg.resultId]: msg.vars,
          };
        }
        return;
      case "loading":
        if (msg.area === "plots") this.plotsLoading = msg.busy;
        return;
      case "status":
        if (msg.error) console.error(`[result-view] ${msg.message}`);
        return;
    }
  };

  private send(msg: WebviewToExtension): void {
    this.vscode.postMessage(msg);
  }

  // Typed handler fields (same shape as the diagram bridge in `webview-entry.ts`)
  // so the template stays declarative and no `as CustomEvent<…>` casts are needed
  // — the `result-ui` events are globally augmented onto `CustomEvent`.

  private readonly onAddPlot = (e: CustomEvent<AddPlotDetail>): void => {
    this.send({ type: "addPlot", afterIndex: e.detail.afterIndex });
  };

  private readonly onDeletePlot = (e: CustomEvent<DeletePlotDetail>): void => {
    this.send({ type: "deletePlot", cardId: e.detail.cardId });
  };

  private readonly onAddTrace = (e: CustomEvent<AddTraceDetail>): void => {
    const { cardId, resultId, variable } = e.detail;
    this.send({ type: "addTrace", cardId, resultId, variable });
  };

  private readonly onRemoveTrace = (e: CustomEvent<RemoveTraceDetail>): void => {
    const { cardId, traceIndex } = e.detail;
    this.send({ type: "removeTrace", cardId, traceIndex });
  };

  private readonly onRequestVariables = (
    e: CustomEvent<RequestVariablesDetail>,
  ): void => {
    this.send({ type: "requestVariables", resultId: e.detail.resultId });
  };

  private readonly onAddResult = (e: CustomEvent<AddResultDetail>): void => {
    this.send({ type: "addResult", via: e.detail.via });
  };

  private readonly onRemoveResult = (e: CustomEvent<RemoveResultDetail>): void => {
    this.send({ type: "removeResult", resultId: e.detail.resultId });
  };

  private readonly onRenameResult = (e: CustomEvent<RenameResultDetail>): void => {
    const { resultId, label } = e.detail;
    this.send({ type: "renameResult", resultId, label });
  };

  override render(): TemplateResult {
    return html`
      <om-result-view-app
        .doc=${this.doc}
        .traceData=${this.traceData}
        .variablesByResult=${this.variablesByResult}
        ?plotsLoading=${this.plotsLoading}
        @om-add-plot=${this.onAddPlot}
        @om-delete-plot=${this.onDeletePlot}
        @om-add-trace=${this.onAddTrace}
        @om-remove-trace=${this.onRemoveTrace}
        @om-request-variables=${this.onRequestVariables}
        @om-add-result=${this.onAddResult}
        @om-remove-result=${this.onRemoveResult}
        @om-rename-result=${this.onRenameResult}
      ></om-result-view-app>
    `;
  }
}
