/**
 * Browser entry point for the diagram webview. Bundled by esbuild into
 * `out/webview.js` and loaded inside the VSCode webview iframe.
 *
 * The script just registers a single `<om-webview-root>` Lit element —
 * the host page (`packages/extension/src/diagram/diagram-webview-html.ts`)
 * drops the tag straight into its body. All wiring (acquiring the VSCode API,
 * listening for host→webview messages, sending `ready`) lives in
 * `connectedCallback` so the element is self-contained.
 */

import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

// Boot Web Awesome's theme + the vscode-token bridge. Side-effect
// import: pulls in the default theme CSS and the bridge sheet so all
// `<wa-*>` elements rendered downstream pick up VSCode's palette
// automatically. esbuild's `.css` loader collects these into
// `out/webview.css`, which `diagram/diagram-webview-html.ts` <link>s to.
import "@dicode/ui-common/webawesome-setup";

import "@dicode/diagram-ui";
import { omTokens } from "@dicode/ui-common";
import type { DiagramLayout, ParameterModel } from "@dicode/omc-client";
import {
  parseKey,
  type ActionFlipDetail,
  type ActionRotateDetail,
  type ActionToolDetail,
  type ChangeClassRequestDetail,
  type LayoutEvents,
  type OmGraphicalLayout,
  type ParameterFormSubmitDetail,
  type ToolId,
} from "@dicode/diagram-ui";

import { assertUnreachable } from "@dicode/modelica-lang-core";

import { CommitSlot } from "./commit-slot.js";
import { panelReadonly } from "./panel-readonly.js";
import { isExtensionMessage } from "./protocol.js";
import type {
  ExtensionToWebview,
  ParameterFormKind,
  WebviewToExtension,
} from "./protocol.js";
import { getVsCodeApi, type VsCodeApi } from "./vscode-api.js";

// Injected by esbuild `define`. Captures the build's wall-clock time so we
// can tell at a glance whether the iframe is running freshly-bundled JS.
declare const __WEBVIEW_BUILD_TIME__: string;

console.log(
  `[webview boot] build=${__WEBVIEW_BUILD_TIME__} loaded=${new Date().toISOString()}`,
);

const RENDER_ERROR_HINT =
  "Make sure the class and its enclosing package load without errors, " +
  "then reopen this editor.";

@customElement("om-webview-root")
class OmWebviewRoot extends LitElement {
  static override styles = [
    omTokens,
    css`
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
    `,
  ];

  @state() private layout: DiagramLayout | null = null;
  /** Set when the host's initial layout fetch failed — there is nothing to
   *  render, so the whole surface becomes an error state. Cleared by a later
   *  successful `init`/`layout`. */
  @state() private renderError: Extract<
    ExtensionToWebview,
    { type: "renderError" }
  > | null = null;
  /** Mirrors whether the diagram has a non-empty selection, so the
   *  action panel can disable the selection-scoped rotate / flip
   *  buttons when nothing is picked. */
  @state() private hasSelection = false;
  /** Read-only class (system library): all edit affordances are suppressed. */
  @state() private readOnly = false;
  /** Host-reported: the shared diagram clipboard holds something pasteable. */
  @state() private hasClipboard = false;
  @state() private activeTool: ToolId = "select";
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

  /** Which modal is open: routes its submit/cancel and, via {@link panelReadonly},
   *  gates whether the form is read-only. Reactive — `render` reads it. */
  @state() private paramKind: ParameterFormKind | null = null;

  private readonly commits = new CommitSlot((layout) =>
    this.vscode?.postMessage({ type: "change", layout }),
  );

  private vscode: VsCodeApi<WebviewToExtension> | null = null;
  private get diagram(): OmGraphicalLayout | null {
    return this.renderRoot.querySelector("om-graphical-layout");
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.vscode = getVsCodeApi<WebviewToExtension>();
    window.addEventListener("message", this.onHostMessage);
    // `disconnectedCallback` is a DOM-removal hook; closing the panel tears the
    // iframe down without one, which would strand the last queued commit.
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("focusin", this.onFocusChange);
    document.addEventListener("focusout", this.onFocusChange);
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.commits.flush();
    window.removeEventListener("message", this.onHostMessage);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("focusin", this.onFocusChange);
    document.removeEventListener("focusout", this.onFocusChange);
  }

  private readonly onPageHide = (): void => {
    this.commits.flush();
  };

  /** Last reported editable-focus state, so we only post on a transition. */
  private inputFocused = false;

  // `focusout` retargets at shadow boundaries and its `relatedTarget` is often
  // null, so we recompute from the post-event active element rather than trust
  // the event target. Deferred a tick so `document.activeElement` reflects the
  // element being focused, not the one being left.
  private readonly onFocusChange = (): void => {
    queueMicrotask(() => {
      const focused = isEditableTarget(deepActiveElement());
      if (focused === this.inputFocused) return;
      this.inputFocused = focused;
      this.post({ type: "inputFocus", focused });
    });
  };

  override render(): TemplateResult {
    if (this.renderError !== null) {
      return html`
        <om-error-state
          heading="Can't render the ${this.renderError.mode}"
          subject=${this.renderError.className}
          detail=${this.renderError.detail}
          hint=${RENDER_ERROR_HINT}
        ></om-error-state>
      `;
    }
    return html`
      <om-graphical-layout
        .layout=${this.layout}
        host-managed-keys
        ?readonly=${this.readOnly}
        ?has-clipboard=${this.hasClipboard}
        ?perf-hud=${true}
        @om-graphical-layout-change=${this.onLayoutChange}
        @om-connection-create=${this.onConnectionCreate}
        @om-selection-change=${this.onSelectionChange}
        @om-add-component-request=${this.onAddComponentRequest}
        @om-double-click=${this.onDoubleClick}
        @om-tool-change=${(e: CustomEvent<LayoutEvents["om-tool-change"]>) =>
          (this.activeTool = e.detail.tool)}
        @om-change-class-request=${this.onChangeClassRequest}
        @om-clipboard-request=${this.onClipboardRequest}
      ></om-graphical-layout>
      <om-overlay-stack anchor="top-right">
        <om-action-panel
          ?no-selection=${!this.hasSelection}
          ?hide-rotate=${this.readOnly}
          ?hide-flip=${this.readOnly}
          ?hide-draw=${this.readOnly}
          .tool=${this.activeTool}
          @om-action-check=${() => this.post({ type: "actionCheck" })}
          @om-action-simulate=${() => this.post({ type: "actionSimulate" })}
          @om-action-parameters=${() => this.post({ type: "actionParameters" })}
          @om-action-rotate=${(e: CustomEvent<ActionRotateDetail>) =>
            this.diagram?.rotateSelection(e.detail.direction === "cw")}
          @om-action-flip=${(e: CustomEvent<ActionFlipDetail>) =>
            this.diagram?.flipSelection(e.detail.axis === "horizontal")}
          @om-action-tool=${(e: CustomEvent<ActionToolDetail>) =>
            this.diagram?.setActiveTool(e.detail.tool)}
        ></om-action-panel>
        <om-parameter-panel
          ?open=${this.paramOpen}
          ?readonly=${panelReadonly(this.readOnly, this.paramKind)}
          ?show-reset=${this.paramComponentName !== null}
          .model=${this.paramModel}
          .heading=${this.paramTitle}
          .submitLabel=${this.paramSubmitLabel}
          .crefPrefix=${this.paramCrefPrefix}
          @om-panel-submit=${this.onParamSubmit}
          @om-panel-cancel=${this.onParamCancel}
          @om-panel-reset=${this.onParamReset}
        ></om-parameter-panel>
      </om-overlay-stack>
    `;
  }

  private readonly onHostMessage = (e: MessageEvent): void => {
    const data: unknown = e.data;
    if (!isExtensionMessage(data)) return;
    this.apply(data);
  };

  private apply(message: ExtensionToWebview): void {
    switch (message.type) {
      case "init":
        this.readOnly = message.readOnly;
        this.hasClipboard = message.hasClipboard;
        this.layout = message.layout;
        this.renderError = null;
        return;
      case "clipboard":
        this.hasClipboard = message.hasClipboard;
        return;
      case "select":
        this.diagram?.setSelection(message.keys);
        return;
      case "layout":
        if (!this.commits.canApplyPush(this.diagram?.gestureActive === true)) {
          return;
        }
        this.layout = message.layout;
        this.renderError = null;
        return;
      case "renderError":
        this.renderError = message;
        console.error(
          `[diagram-ui] failed to render ${message.mode} for ${message.className}: ${message.detail}`,
        );
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
            ? (message.crefPrefix ?? null)
            : null;
        this.paramOpen = true;
        return;
      case "parametersClose":
        this.paramOpen = false;
        this.paramKind = null;
        this.paramComponentName = null;
        return;
      case "runCommand":
        this.diagram?.runCommandById(message.commandId);
        return;
      case "placementStart":
        this.diagram?.beginPlacement(message.className);
        return;
      case "placementPreview":
        this.diagram?.setPlacementPreview(message.classDef);
        return;
      case "placementCancel":
        this.diagram?.cancelPlacement();
        return;
      case "error":
        console.error("[diagram-ui] backend error:", message.message);
        return;
      default:
        assertUnreachable(message, "ExtensionToWebview");
    }
  }

  private post(msg: WebviewToExtension): void {
    this.commits.beforeSending(msg.type);
    this.vscode?.postMessage(msg);
  }

  private onLayoutChange = (
    e: CustomEvent<LayoutEvents["om-graphical-layout-change"]>,
  ): void => {
    // Keeps the layout this element renders and the layout the diagram shows
    // as one thing. They diverge from the first gesture otherwise, and every
    // later render binds one that predates it.
    this.layout = e.detail;
    this.commits.commit(e.detail);
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
    this.hasSelection = e.detail.keys.length > 0;
    this.post({ type: "selectionChange", keys: e.detail.keys });
  };

  private onDoubleClick = (
    e: CustomEvent<LayoutEvents["om-double-click"]>,
  ): void => {
    // Components and shapes open their editor; connectors, labels and empty
    // canvas reach us through the same event and are ignored.
    const parsed = parseKey(e.detail.key);
    if (!parsed) return;
    if (parsed.kind === "shape") {
      this.post({ type: "editShape", key: e.detail.key });
      return;
    }
    if (parsed.kind !== "component" || parsed.nodeId.length === 0) {
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

  private onChangeClassRequest = (
    e: CustomEvent<ChangeClassRequestDetail>,
  ): void => {
    const { componentName, currentClass } = e.detail;
    this.post({ type: "changeClassRequest", componentName, currentClass });
  };

  private onClipboardRequest = (
    e: CustomEvent<LayoutEvents["om-clipboard-request"]>,
  ): void => {
    const detail = e.detail;
    this.post(
      detail.action === "copy"
        ? { type: "copySelection", keys: detail.keys }
        : { type: "paste" },
    );
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

/** Innermost focused node, descending through open shadow roots. */
function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

function isEditableTarget(node: Element | null): boolean {
  if (node === null) return false;
  if (node instanceof HTMLInputElement) {
    // Buttons / checkboxes don't swallow typed characters, so a shortcut over
    // one is still the diagram's to handle.
    return !["button", "checkbox", "radio", "submit", "reset"].includes(
      node.type,
    );
  }
  return (
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement ||
    (node instanceof HTMLElement && node.isContentEditable)
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "om-webview-root": OmWebviewRoot;
  }
}
