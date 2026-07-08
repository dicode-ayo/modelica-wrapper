/**
 * Browser entry for the library sidebar webview view. Bundled by esbuild into
 * `out/library-view.js` and loaded inside the sidebar's webview iframe by
 * `tree/library-webview-provider.ts`.
 *
 * Renders a full-height `<om-library-tree>` fed by the shared
 * `WebviewLibraryDataSource` bridge, plus its own loading / empty / error
 * chrome (a webview view gets no `viewsWelcome`). A row click opens the class's
 * diagram; a row press-drag begins host-mediated placement onto the diagram
 * canvas (HTML5 drag can't cross the webview iframe, so only the class name is
 * relayed — the diagram draws its own ghost).
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import "@dicode/diagram-ui";
import type {
  LibraryPlacementStartDetail,
  LibraryEvents,
} from "@dicode/diagram-ui";
import { omTokens } from "@dicode/ui-common";

import { WebviewLibraryDataSource } from "./library-data-source.js";
import type {
  ExtensionToLibraryView,
  LibraryViewToExtension,
} from "./library-view-protocol.js";

interface VsCodeApi {
  postMessage(msg: LibraryViewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cachedApi: VsCodeApi | null = null;
function getVsCodeApi(): VsCodeApi {
  if (!cachedApi) {
    cachedApi = acquireVsCodeApi();
  }
  return cachedApi;
}

type Phase = "loading" | "empty" | "error" | "ready";

@customElement("om-library-view-root")
export class OmLibraryViewRoot extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        position: absolute;
        inset: 0;
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, var(--om-tree-font-size));
      }
      om-library-tree {
        display: flex;
        block-size: 100%;
      }
      .state {
        display: flex;
        flex-direction: column;
        gap: var(--om-space-md);
        padding: var(--om-space-lg);
        color: var(--vscode-descriptionForeground);
        font-size: var(--om-description-size);
      }
      .state.error {
        color: var(--vscode-errorForeground);
      }
      .hint {
        color: var(--vscode-descriptionForeground);
      }
      button {
        align-self: flex-start;
        padding: var(--om-input-padding);
        font: inherit;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: var(--om-radius-md);
        cursor: pointer;
      }
      button:hover {
        background: var(--vscode-button-hoverBackground);
      }
    `,
  ];

  @state() private phase: Phase = "loading";
  @state() private errorText = "";
  /** Bumped on each reload so `<om-library-tree>` re-fetches against the same
   *  source. A fresh source would restart request ids and collide with any
   *  in-flight request, routing its response to the wrong instance. */
  @state() private reloadToken = 0;

  private readonly vscode = getVsCodeApi();
  /** One persistent bridge for the view's lifetime — never swapped. Replacing
   *  it while a tree fetch is in flight would orphan that request's response
   *  and hang the row on "Loading…". */
  private readonly source = new WebviewLibraryDataSource((msg) =>
    this.vscode.postMessage(msg),
  );
  /** Drops stale top-level probes when reloads overlap during OMC startup. */
  private probeSeq = 0;
  /** True between a row press and the matching release, so a release cancels an
   *  uncommitted placement (a plain click, or a drag that never reached the
   *  canvas). A drop over the canvas commits in the diagram webview and never
   *  reaches this iframe's `pointerup`. */
  private placing = false;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.onHostMessage);
    window.addEventListener("pointerup", this.onGlobalPointerUp);
    window.addEventListener("pointercancel", this.onGlobalPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    this.reload();
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onHostMessage);
    window.removeEventListener("pointerup", this.onGlobalPointerUp);
    window.removeEventListener("pointercancel", this.onGlobalPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  /** Re-fetch on the existing source: bump the token so the tree rebuilds, and
   *  probe the top level to pick the chrome (loading → empty / error / ready).
   *  Overlapping reloads during OMC startup are serialised by `probeSeq`. */
  private reload(): void {
    this.phase = "loading";
    this.reloadToken += 1;
    const seq = ++this.probeSeq;
    this.source
      .listChildren(null)
      .then((items) => {
        if (seq !== this.probeSeq) return;
        this.phase = items.length === 0 ? "empty" : "ready";
      })
      .catch((err: unknown) => {
        if (seq !== this.probeSeq) return;
        this.errorText = err instanceof Error ? err.message : String(err);
        this.phase = "error";
      });
  }

  private readonly onHostMessage = (e: MessageEvent): void => {
    const data = e.data as ExtensionToLibraryView | undefined;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    switch (data.type) {
      case "libraryChildren":
      case "librarySearchResult":
        this.source.handleResponse(data);
        return;
      case "libraryIconResult":
        this.source.handleIconResponse(data);
        return;
      case "reload":
        this.reload();
        return;
    }
  };

  private readonly onGlobalPointerUp = (): void => {
    this.cancelPlacement();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.cancelPlacement();
    }
  };

  private cancelPlacement(): void {
    if (!this.placing) return;
    this.placing = false;
    this.vscode.postMessage({ type: "placementCancel" });
  }

  override render(): TemplateResult {
    switch (this.phase) {
      case "loading":
        return html`<div class="state">Loading libraries…</div>`;
      case "error":
        return html`<div class="state error">
          <span>Failed to load libraries: ${this.errorText}</span>
          <button @click=${this.onReloadClick}>Retry</button>
        </div>`;
      case "empty":
        return html`<div class="state">
          <span>No Modelica libraries are loaded yet.</span>
          <button @click=${this.onLoadLibrary}>Load Library…</button>
          <span class="hint"
            >The default "Modelica" name resolves the Modelica Standard Library
            from your MODELICAPATH.</span
          >
        </div>`;
      case "ready":
        return html`<om-library-tree
          placement-drag
          .dataSource=${this.source}
          .reloadToken=${this.reloadToken}
          @om-library-select=${this.onSelect}
          @om-library-placement-start=${this.onPlacementStart}
        ></om-library-tree>`;
    }
  }

  private readonly onSelect = (
    e: CustomEvent<LibraryEvents["om-library-select"]>,
  ): void => {
    this.vscode.postMessage({
      type: "openDiagram",
      className: e.detail.className,
    });
  };

  private readonly onPlacementStart = (
    e: CustomEvent<LibraryPlacementStartDetail>,
  ): void => {
    this.placing = true;
    this.vscode.postMessage({
      type: "placementStart",
      className: e.detail.className,
    });
  };

  private readonly onLoadLibrary = (): void => {
    this.vscode.postMessage({ type: "loadLibrary" });
  };

  private readonly onReloadClick = (): void => {
    this.reload();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "om-library-view-root": OmLibraryViewRoot;
  }
}
