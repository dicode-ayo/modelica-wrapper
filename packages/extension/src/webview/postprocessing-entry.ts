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
  private requestSeq = 0;

  @state() private doc: ResultViewDoc | undefined;
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
      case "traceData":
        this.traceData = {
          ...this.traceData,
          [msg.cardId]: [...(this.traceData[msg.cardId] ?? []), msg.trace],
        };
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

  override render(): TemplateResult {
    if (!this.doc) {
      return html`<p style="padding: 16px">Loading…</p>`;
    }
    return html`
      <om-result-view-app
        .doc=${this.doc}
        .traceData=${this.traceData}
        .variablesByResult=${this.variablesByResult}
        ?plotsLoading=${this.plotsLoading}
        @om-add-plot=${(e: Event) =>
          this.send({ type: "addPlot", afterIndex: (e as CustomEvent<AddPlotDetail>).detail.afterIndex })}
        @om-delete-plot=${(e: Event) =>
          this.send({ type: "deletePlot", cardId: (e as CustomEvent<DeletePlotDetail>).detail.cardId })}
        @om-add-trace=${(e: Event) => {
          const d = (e as CustomEvent<AddTraceDetail>).detail;
          this.send({ type: "addTrace", cardId: d.cardId, resultId: d.resultId, variable: d.variable });
        }}
        @om-remove-trace=${(e: Event) => {
          const d = (e as CustomEvent<RemoveTraceDetail>).detail;
          this.send({ type: "removeTrace", cardId: d.cardId, traceIndex: d.traceIndex });
        }}
        @om-request-variables=${(e: Event) =>
          this.send({
            type: "requestVariables",
            requestId: `v${++this.requestSeq}`,
            resultId: (e as CustomEvent<RequestVariablesDetail>).detail.resultId,
          })}
        @om-add-result=${(e: Event) =>
          this.send({ type: "addResult", via: (e as CustomEvent<AddResultDetail>).detail.via })}
        @om-remove-result=${(e: Event) =>
          this.send({ type: "removeResult", resultId: (e as CustomEvent<RemoveResultDetail>).detail.resultId })}
        @om-rename-result=${(e: Event) => {
          const d = (e as CustomEvent<RenameResultDetail>).detail;
          this.send({ type: "renameResult", resultId: d.resultId, label: d.label });
        }}
      ></om-result-view-app>
    `;
  }
}
