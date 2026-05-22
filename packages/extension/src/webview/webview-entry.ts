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

// Boot Web Awesome's theme + the vscode-token bridge. Side-effect
// import: pulls in the default theme CSS and the bridge sheet so all
// `<wa-*>` elements rendered downstream pick up VSCode's palette
// automatically. esbuild's `.css` loader collects these into
// `out/webview.css`, which `diagram/panel.ts` <link>s to.
import "@modelica-wrapper/ui-common/webawesome-setup";

import "@modelica-wrapper/diagram-ui";
import type {
  DiagramLayout,
  ParameterModel,
} from "@modelica-wrapper/omc-client";
import {
  isComponentKey,
  parseKey,
  type LayoutEvents,
  type LibraryBrowserDataSource,
  type LibraryClassInfo,
  type ParameterFormSubmitDetail,
} from "@modelica-wrapper/diagram-ui";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "./protocol.js";

/**
 * Bridges the diagram-ui's `LibraryBrowserDataSource` interface (which
 * speaks plain promises) onto our async postMessage protocol. Each
 * `listChildren` / `searchAll` call mints a `requestId`, posts the
 * matching request, and parks the resolve/reject pair in `pending`.
 * The webview-root forwards every `libraryChildren` /
 * `librarySearchResult` message in via `handleResponse`, which drains
 * the matching entry.
 *
 * Requests stay in the map until a response arrives — there's no
 * timeout. The extension host always replies (success or
 * `{ error: …}`), so a stuck request implies a host bug worth seeing
 * in the console rather than masking with a fake rejection.
 */
class WebviewLibraryDataSource implements LibraryBrowserDataSource {
  private nextId = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (items: LibraryClassInfo[]) => void;
      reject: (err: Error) => void;
    }
  >();
  // Icon requests resolve to an SVG string (or undefined for "no icon"),
  // so they get their own correlation map keyed on the same id space.
  private readonly pendingIcons = new Map<
    string,
    {
      resolve: (svg: string | undefined) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(private readonly post: (msg: WebviewToExtension) => void) {}

  listChildren(parent: string | null): Promise<LibraryClassInfo[]> {
    return new Promise((resolve, reject) => {
      const requestId = this.mintId();
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: "libraryListChildren", requestId, parent });
    });
  }

  searchAll(query: string): Promise<LibraryClassInfo[]> {
    return new Promise((resolve, reject) => {
      const requestId = this.mintId();
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: "librarySearch", requestId, query });
    });
  }

  iconSvg(className: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const requestId = this.mintId();
      this.pendingIcons.set(requestId, { resolve, reject });
      this.post({ type: "libraryIcon", requestId, className });
    });
  }

  handleResponse(message: {
    requestId: string;
    items?: LibraryClassInfo[];
    error?: string;
  }): void {
    const entry = this.pending.get(message.requestId);
    if (!entry) return;
    this.pending.delete(message.requestId);
    if (message.error !== undefined) {
      entry.reject(new Error(message.error));
      return;
    }
    entry.resolve(message.items ?? []);
  }

  handleIconResponse(message: {
    requestId: string;
    svg?: string;
    error?: string;
  }): void {
    const entry = this.pendingIcons.get(message.requestId);
    if (!entry) return;
    this.pendingIcons.delete(message.requestId);
    if (message.error !== undefined) {
      entry.reject(new Error(message.error));
      return;
    }
    entry.resolve(message.svg);
  }

  private mintId(): string {
    this.nextId += 1;
    return `lib-${this.nextId}`;
  }
}

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
  @state() private paramModel: ParameterModel | undefined = undefined;
  @state() private paramTitle = "";
  @state() private paramSubmitLabel = "Apply";
  @state() private paramCrefPrefix: string | undefined = undefined;
  /**
   * Sub-component instance the modal targets, set only for the
   * `componentParams` kind. Drives the "Reset to defaults" affordance:
   * the button shows iff this is non-null, and its name rides the
   * `resetComponentParameters` message back to the host.
   */
  @state() private paramComponentName: string | null = null;

  /** Opaque tag the extension uses to route the modal's submit/cancel
   *  back to the right command flow. */
  private paramKind: string | null = null;

  private vscode: VsCodeApi | null = null;
  /** Async bridge for the library browser. Constructed lazily on
   *  first connect because it captures `this.post` which is bound to
   *  the cached VSCode API handle. */
  private librarySource: WebviewLibraryDataSource | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.vscode = getVsCodeApi();
    this.librarySource = new WebviewLibraryDataSource((msg) => this.post(msg));
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
        .libraryDataSource=${this.librarySource}
        @om-graphical-layout-change=${this.onLayoutChange}
        @om-connection-create=${this.onConnectionCreate}
        @om-selection-change=${this.onSelectionChange}
        @om-add-component-request=${this.onAddComponentRequest}
        @om-double-click=${this.onDoubleClick}
      ></om-graphical-layout>
      <om-action-panel
        anchor="top-right"
        @om-action-undo=${() => this.post({ type: "actionUndo" })}
        @om-action-check=${() => this.post({ type: "actionCheck" })}
        @om-action-simulate=${() => this.post({ type: "actionSimulate" })}
        @om-action-parameters=${() => this.post({ type: "actionParameters" })}
      ></om-action-panel>
      <om-parameter-panel
        ?open=${this.paramOpen}
        ?show-reset=${this.paramComponentName !== null}
        .model=${this.paramModel}
        .title=${this.paramTitle}
        .submitLabel=${this.paramSubmitLabel}
        .crefPrefix=${this.paramCrefPrefix}
        @om-panel-submit=${this.onParamSubmit}
        @om-panel-cancel=${this.onParamCancel}
        @om-panel-reset=${this.onParamReset}
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
        this.paramModel = message.model;
        this.paramTitle = message.title;
        this.paramSubmitLabel = message.submitLabel ?? "Apply";
        this.paramCrefPrefix = message.crefPrefix;
        this.paramKind = message.kind;
        // Only the sub-component modal carries a reset target; for it the
        // crefPrefix is the component instance name (see open-diagram's
        // onEditComponent). Class-level / simulate forms leave it null,
        // which hides the reset button.
        this.paramComponentName =
          message.kind === "componentParams"
            ? message.crefPrefix ?? null
            : null;
        this.paramOpen = true;
        return;
      case "parametersClose":
        this.paramOpen = false;
        this.paramKind = null;
        this.paramComponentName = null;
        return;
      case "libraryChildren":
      case "librarySearchResult":
        // Both share the same {requestId, items?, error?} shape; the
        // data source's correlation map keys on requestId alone.
        this.librarySource?.handleResponse(message);
        return;
      case "libraryIconResult":
        this.librarySource?.handleIconResponse(message);
        return;
      case "error":
        console.error("[diagram-ui] backend error:", message.message);
        return;
    }
  }

  private post(msg: WebviewToExtension): void {
    this.vscode?.postMessage(msg);
  }

  private onLayoutChange = (
    e: CustomEvent<LayoutEvents["om-graphical-layout-change"]>,
  ): void => {
    this.post({ type: "change", layout: e.detail });
  };

  private onConnectionCreate = (
    e: CustomEvent<LayoutEvents["om-connection-create"]>,
  ): void => {
    const { fromKey, toKey, waypoints } = e.detail;
    this.post({ type: "connectionCreate", fromKey, toKey, waypoints });
  };

  private onSelectionChange = (
    e: CustomEvent<LayoutEvents["om-selection-change"]>,
  ): void => {
    this.post({ type: "selectionChange", keys: e.detail.keys });
  };

  private onDoubleClick = (
    e: CustomEvent<LayoutEvents["om-double-click"]>,
  ): void => {
    // Components are the only kind we route to the extension as an
    // edit gesture. Connectors / labels / empty canvas double-clicks
    // reach us via the same event but go through other gestures
    // (library browser, etc.) — silently ignore them here.
    const parsed = parseKey(e.detail.key);
    if (!parsed || !isComponentKey(parsed) || parsed.nodeId.length === 0) {
      return;
    }
    this.post({ type: "editComponent", componentName: parsed.nodeId });
  };

  private onAddComponentRequest = (
    e: CustomEvent<LayoutEvents["om-add-component-request"]>,
  ): void => {
    const { className, position } = e.detail;
    this.post({
      type: "addComponent",
      className,
      position,
    });
  };

  private onParamSubmit = (e: CustomEvent<ParameterFormSubmitDetail>): void => {
    if (this.paramKind === null) return;
    this.post({
      type: "parametersSubmit",
      kind: this.paramKind,
      values: e.detail.values,
    });
  };

  private onParamCancel = (): void => {
    if (this.paramKind === null) return;
    const kind = this.paramKind;
    // Close locally — the extension does not echo a close for cancels.
    this.paramOpen = false;
    this.paramKind = null;
    this.paramComponentName = null;
    this.post({ type: "parametersCancel", kind });
  };

  private onParamReset = (): void => {
    // Reset is only offered for the component modal, which always carries
    // a component name. Guard anyway so a stray event can't post garbage.
    if (this.paramComponentName === null) return;
    // Keep the modal open: the host bulk-clears, re-fetches, and re-opens
    // it with the defaulted values via a fresh `parametersOpen`.
    this.post({
      type: "resetComponentParameters",
      componentName: this.paramComponentName,
    });
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "om-webview-root": OmWebviewRoot;
  }
}
