/**
 * Browser entry point for the documentation webview. Bundled by esbuild into
 * `out/documentation.js` and loaded by `DocumentationEditorProvider`'s HTML,
 * which drops `<om-documentation-root>` into its body.
 *
 * `<om-documentation-root>` is the bridge to the VSCode webview API: it acquires
 * the API, posts `ready`, mounts a TipTap editor over the class's
 * `Documentation(info=…)` HTML, and posts an `edit` on every real change. TipTap
 * parses HTML against an explicit schema, so it also *is* the sanitizer — it
 * only ever renders a parsed ProseMirror document, never a raw HTML string.
 *
 * The component renders into light DOM (`createRenderRoot` returns `this`):
 * ProseMirror's selection handling is unreliable across shadow-DOM boundaries,
 * and the webview page is single-purpose, so unscoped styles are fine.
 */

import { Editor } from "@tiptap/core";
import { LitElement, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "./documentation-protocol.js";
import {
  splitInfoWrapper,
  wrapInfo,
  type InfoParts,
} from "./documentation-roundtrip.js";
import { documentationExtensions } from "./documentation-schema.js";
import { getVsCodeApi } from "./vscode-api.js";

// Coalesce a burst of keystrokes into one write once the editor settles.
const EDIT_DEBOUNCE_MS = 300;

type Mode = "wysiwyg" | "source";

@customElement("om-documentation-root")
export class OmDocumentationRoot extends LitElement {
  // ProseMirror wants light DOM (see file header).
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  @state() private mode: Mode = "wysiwyg";
  @state() private error: string | null = null;
  @state() private loaded = false;
  @state() private readOnly = false;
  /** Full `info` (wrapper included) — the source of truth the Source tab edits. */
  @state() private info = "";

  private parts: InfoParts = { prefix: "", inner: "", suffix: "" };
  private editor: Editor | null = null;
  private editTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly vscode = getVsCodeApi<DocWebviewToExtension>();

  private get editorHost(): HTMLElement | null {
    return this.renderRoot.querySelector(".om-doc-editor");
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this.onMessage);
    this.vscode.postMessage({ type: "ready" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onMessage);
    if (this.editTimer !== undefined) clearTimeout(this.editTimer);
    this.editor?.destroy();
    this.editor = null;
  }

  override firstUpdated(): void {
    const host = this.editorHost;
    if (host === null) return;
    this.editor = new Editor({
      element: host,
      extensions: documentationExtensions,
      editable: false,
      onUpdate: () => this.onEditorUpdate(),
      onSelectionUpdate: () => this.requestUpdate(),
      onTransaction: () => this.requestUpdate(),
    });
    if (this.loaded) this.loadIntoEditor();
  }

  private readonly onMessage = (
    e: MessageEvent<DocExtensionToWebview>,
  ): void => {
    const msg = e.data;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    switch (msg.type) {
      case "doc":
        this.applyDoc(msg.info, msg.readOnly);
        return;
      case "error":
        this.error = msg.message;
        return;
    }
  };

  private applyDoc(info: string, readOnly: boolean): void {
    this.error = null;
    this.readOnly = readOnly;
    this.info = info;
    this.parts = splitInfoWrapper(info);
    this.loaded = true;
    if (this.editor) this.loadIntoEditor();
  }

  /**
   * Seed the editor from the current `info` without emitting an update — loading
   * is not a user edit, so it must not post one back and dirty the buffer.
   */
  private loadIntoEditor(): void {
    if (!this.editor) return;
    this.editor.setEditable(!this.readOnly);
    this.editor.commands.setContent(this.parts.inner, { emitUpdate: false });
  }

  private onEditorUpdate(): void {
    if (!this.editor) return;
    this.info = wrapInfo(this.editor.getHTML(), this.parts);
    this.scheduleEdit();
  }

  private scheduleEdit(): void {
    if (this.editTimer !== undefined) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = undefined;
      this.vscode.postMessage({ type: "edit", info: this.info });
    }, EDIT_DEBOUNCE_MS);
  }

  private setMode(mode: Mode): void {
    if (mode === this.mode) return;
    // Leaving Source: the raw text may have changed the wrapper too, so re-split
    // and reload the editor from it (out-of-schema tags drop — that's the tab's
    // documented trade-off).
    if (mode === "wysiwyg") {
      this.parts = splitInfoWrapper(this.info);
      this.loadIntoEditor();
    }
    this.mode = mode;
  }

  private readonly onSourceInput = (e: Event): void => {
    this.info = (e.target as HTMLTextAreaElement).value;
    this.scheduleEdit();
  };

  private run(fn: (chain: ReturnType<Editor["chain"]>) => void): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    fn(chain);
  }

  private toggleLink(): void {
    if (!this.editor) return;
    if (this.editor.isActive("link")) {
      this.editor.chain().focus().unsetLink().run();
      return;
    }
    const href = window.prompt("Link target (href):", "modelica://");
    if (href) this.editor.chain().focus().setLink({ href }).run();
  }

  override render(): TemplateResult {
    return html`
      ${STYLE}
      <div class="om-doc-toolbar">
        <div class="om-doc-tabs" role="tablist">
          <button
            role="tab"
            aria-selected=${this.mode === "wysiwyg"}
            @click=${() => this.setMode("wysiwyg")}
          >
            Edit
          </button>
          <button
            role="tab"
            aria-selected=${this.mode === "source"}
            @click=${() => this.setMode("source")}
          >
            Source
          </button>
        </div>
        ${this.mode === "wysiwyg" && !this.readOnly
          ? this.renderFormatButtons()
          : null}
        ${this.readOnly
          ? html`<span class="om-doc-badge">Read-only</span>`
          : null}
      </div>

      ${this.error !== null
        ? html`<div class="om-doc-error">${this.error}</div>`
        : null}

      <div class="om-doc-editor" ?hidden=${this.mode !== "wysiwyg"}></div>
      <textarea
        class="om-doc-source"
        spellcheck="false"
        ?hidden=${this.mode !== "source"}
        ?readonly=${this.readOnly}
        .value=${this.info}
        @input=${this.onSourceInput}
      ></textarea>
    `;
  }

  private renderFormatButtons(): TemplateResult {
    const active = (name: string, attrs?: Record<string, unknown>): string =>
      this.editor?.isActive(name, attrs) ? "is-active" : "";
    return html`
      <div class="om-doc-format" role="toolbar">
        <button
          class=${active("bold")}
          title="Bold"
          @click=${() => this.run((c) => c.toggleBold().run())}
        >
          <b>B</b>
        </button>
        <button
          class=${active("italic")}
          title="Italic"
          @click=${() => this.run((c) => c.toggleItalic().run())}
        >
          <i>I</i>
        </button>
        <button
          class=${active("underline")}
          title="Underline"
          @click=${() => this.run((c) => c.toggleUnderline().run())}
        >
          <u>U</u>
        </button>
        <button
          class=${active("code")}
          title="Inline code"
          @click=${() => this.run((c) => c.toggleCode().run())}
        >
          &lt;/&gt;
        </button>
        <button
          class=${active("heading", { level: 2 })}
          title="Heading"
          @click=${() => this.run((c) => c.toggleHeading({ level: 2 }).run())}
        >
          H
        </button>
        <button
          class=${active("bulletList")}
          title="Bullet list"
          @click=${() => this.run((c) => c.toggleBulletList().run())}
        >
          •
        </button>
        <button
          class=${active("orderedList")}
          title="Numbered list"
          @click=${() => this.run((c) => c.toggleOrderedList().run())}
        >
          1.
        </button>
        <button
          class=${active("link")}
          title="Link"
          @click=${() => this.toggleLink()}
        >
          🔗
        </button>
      </div>
    `;
  }
}

const STYLE = html`
  <style>
    om-documentation-root {
      --om-doc-pad: 1rem;
      --om-doc-gap: 0.5rem;
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .om-doc-toolbar {
      display: flex;
      align-items: center;
      gap: var(--om-doc-gap);
      padding: var(--om-doc-gap) var(--om-doc-pad);
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
      flex: 0 0 auto;
    }
    .om-doc-tabs,
    .om-doc-format {
      display: flex;
      gap: 2px;
    }
    .om-doc-badge {
      margin-inline-start: auto;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }
    .om-doc-toolbar button {
      min-width: 1.9rem;
      padding: 0.15rem 0.4rem;
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
    }
    .om-doc-toolbar button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .om-doc-tabs button[aria-selected="true"],
    .om-doc-format button.is-active {
      background: var(
        --vscode-toolbar-activeBackground,
        rgba(128, 128, 128, 0.2)
      );
      border-color: var(--vscode-focusBorder, transparent);
    }
    .om-doc-editor,
    .om-doc-source {
      flex: 1 1 auto;
      overflow: auto;
      padding: var(--om-doc-pad);
    }
    .om-doc-editor .ProseMirror {
      min-height: 100%;
      outline: none;
      line-height: 1.5;
      max-width: 48rem;
    }
    .om-doc-editor .ProseMirror:focus {
      outline: none;
    }
    .om-doc-editor a {
      color: var(--vscode-textLink-foreground);
    }
    .om-doc-editor code,
    .om-doc-editor pre {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background);
    }
    .om-doc-editor pre {
      padding: var(--om-doc-gap);
      overflow-x: auto;
    }
    .om-doc-editor table {
      border-collapse: collapse;
    }
    .om-doc-editor th,
    .om-doc-editor td {
      border: 1px solid var(--vscode-editorWidget-border, currentColor);
      padding: 0.25rem 0.5rem;
    }
    .om-doc-editor img {
      max-width: 100%;
    }
    .om-doc-source {
      resize: none;
      border: none;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre;
    }
    .om-doc-source:focus {
      outline: none;
    }
    .om-doc-error {
      padding: var(--om-doc-gap) var(--om-doc-pad);
      color: var(--vscode-errorForeground);
    }
    [hidden] {
      display: none !important;
    }
  </style>
`;

declare global {
  interface HTMLElementTagNameMap {
    "om-documentation-root": OmDocumentationRoot;
  }
}
