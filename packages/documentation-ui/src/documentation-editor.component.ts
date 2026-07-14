import { Editor } from "@tiptap/core";
import {
  LitElement,
  html,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { DocumentationChangeDetail } from "./events.js";
import {
  splitInfoWrapper,
  wrapInfo,
  type InfoParts,
} from "./documentation-roundtrip.js";
import { documentationExtensions } from "./documentation-schema.js";

// Coalesce a burst of keystrokes into one change once the editor settles.
const EDIT_DEBOUNCE_MS = 300;

type Mode = "wysiwyg" | "source";

/**
 * WYSIWYG editor for a Modelica class's `Documentation(info="<html>…</html>")`.
 * A pure renderer: it takes `info` in and emits `om-documentation-change` out,
 * with no host dependency, so the same element serves the VSCode custom editor
 * and a web client.
 *
 * TipTap parses HTML against an explicit schema, so the editor also *is* the
 * sanitizer — it only ever renders a parsed ProseMirror document, never a raw
 * HTML string. A raw-HTML Source tab is the escape hatch for markup the schema
 * drops.
 *
 * Renders into light DOM (`createRenderRoot` returns `this`): ProseMirror's
 * selection handling is unreliable across shadow-DOM boundaries. Styles are
 * namespaced under the `om-documentation-editor` tag instead of scoped.
 */
@customElement("om-documentation-editor")
export class OmDocumentationEditor extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Full `info` (wrapper included). The authoritative value the host sets. */
  @property({ attribute: false }) info = "";
  @property({ type: Boolean, reflect: true }) readOnly = false;

  @state() private mode: Mode = "wysiwyg";
  /** The working `info` — diverges from `info` between edit and the next load. */
  @state() private current = "";
  @state() private linkEditing = false;
  @state() private linkDraft = "";

  private parts: InfoParts = { prefix: "", inner: "", suffix: "" };
  private editor: Editor | null = null;
  private editTimer: ReturnType<typeof setTimeout> | undefined;

  private get editorHost(): HTMLElement | null {
    return this.renderRoot.querySelector(".om-doc-editor");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.editTimer !== undefined) clearTimeout(this.editTimer);
    this.editor?.destroy();
    this.editor = null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("info")) {
      this.current = this.info;
      this.parts = splitInfoWrapper(this.info);
      this.loadIntoEditor();
    } else if (changed.has("readOnly")) {
      this.editor?.setEditable(!this.readOnly);
    }
  }

  override firstUpdated(): void {
    const host = this.editorHost;
    if (host === null) return;
    this.editor = new Editor({
      element: host,
      extensions: documentationExtensions,
      editable: !this.readOnly,
      onUpdate: () => this.onEditorUpdate(),
      onTransaction: () => this.requestUpdate(),
    });
    this.loadIntoEditor();
  }

  /**
   * Seed the editor from `current` without emitting an update — loading is not a
   * user edit, so it must not emit one back and dirty the host's buffer.
   */
  private loadIntoEditor(): void {
    if (!this.editor) return;
    this.editor.setEditable(!this.readOnly);
    this.editor.commands.setContent(this.parts.inner, { emitUpdate: false });
  }

  private onEditorUpdate(): void {
    if (!this.editor) return;
    this.current = wrapInfo(this.editor.getHTML(), this.parts);
    this.scheduleChange();
  }

  private scheduleChange(): void {
    if (this.editTimer !== undefined) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = undefined;
      this.dispatchEvent(
        new CustomEvent<DocumentationChangeDetail>("om-documentation-change", {
          detail: { info: this.current },
          bubbles: true,
          composed: true,
        }),
      );
    }, EDIT_DEBOUNCE_MS);
  }

  private setMode(mode: Mode): void {
    if (mode === this.mode) return;
    // Leaving Source: the raw text may have changed the wrapper too, so re-split
    // and reload the editor from it (out-of-schema tags drop — that's the tab's
    // documented trade-off).
    if (mode === "wysiwyg") {
      this.parts = splitInfoWrapper(this.current);
      this.loadIntoEditor();
    }
    this.mode = mode;
  }

  private readonly onSourceInput = (e: Event): void => {
    this.current = (e.target as HTMLTextAreaElement).value;
    this.scheduleChange();
  };

  private run(fn: (chain: ReturnType<Editor["chain"]>) => void): void {
    if (!this.editor) return;
    fn(this.editor.chain().focus());
  }

  private openLinkEditor(): void {
    if (!this.editor) return;
    if (this.editor.isActive("link")) {
      this.editor.chain().focus().unsetLink().run();
      return;
    }
    this.linkDraft =
      (this.editor.getAttributes("link").href as string | undefined) ??
      "modelica://";
    this.linkEditing = true;
  }

  private applyLink(): void {
    const href = this.linkDraft.trim();
    if (href.length > 0) {
      this.editor?.chain().focus().setLink({ href }).run();
    }
    this.linkEditing = false;
  }

  private readonly onLinkKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.applyLink();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.linkEditing = false;
    }
  };

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

      ${this.linkEditing ? this.renderLinkInput() : null}

      <div class="om-doc-editor" ?hidden=${this.mode !== "wysiwyg"}></div>
      <textarea
        class="om-doc-source"
        spellcheck="false"
        ?hidden=${this.mode !== "source"}
        ?readonly=${this.readOnly}
        .value=${this.current}
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
          &bull;
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
          @click=${() => this.openLinkEditor()}
        >
          &#128279;
        </button>
      </div>
    `;
  }

  private renderLinkInput(): TemplateResult {
    return html`
      <div class="om-doc-linkbar">
        <input
          class="om-doc-linkinput"
          type="text"
          placeholder="Link target (href)"
          .value=${this.linkDraft}
          @input=${(e: Event) =>
            (this.linkDraft = (e.target as HTMLInputElement).value)}
          @keydown=${this.onLinkKeydown}
        />
        <button title="Apply link" @click=${() => this.applyLink()}>
          Apply
        </button>
        <button title="Cancel" @click=${() => (this.linkEditing = false)}>
          Cancel
        </button>
      </div>
    `;
  }
}

const STYLE = html`
  <style>
    om-documentation-editor {
      --om-doc-pad: 1rem;
      --om-doc-gap: 0.5rem;
      --om-doc-measure: 48rem;
      --om-doc-control-gap: 2px;
      --om-doc-control-radius: 3px;
      --om-doc-control-pad-block: 0.15rem;
      --om-doc-control-pad-inline: 0.4rem;
      --om-doc-control-min: 1.9rem;
      --om-doc-badge-size: 0.85em;
      --om-doc-active-fallback: rgba(128, 128, 128, 0.2);
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    om-documentation-editor .om-doc-toolbar {
      display: flex;
      align-items: center;
      gap: var(--om-doc-gap);
      padding: var(--om-doc-gap) var(--om-doc-pad);
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
      flex: 0 0 auto;
    }
    om-documentation-editor .om-doc-tabs,
    om-documentation-editor .om-doc-format {
      display: flex;
      gap: var(--om-doc-control-gap);
    }
    om-documentation-editor .om-doc-badge {
      margin-inline-start: auto;
      color: var(--vscode-descriptionForeground);
      font-size: var(--om-doc-badge-size);
    }
    om-documentation-editor button {
      min-width: var(--om-doc-control-min);
      padding: var(--om-doc-control-pad-block) var(--om-doc-control-pad-inline);
      color: var(--vscode-foreground);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--om-doc-control-radius);
      cursor: pointer;
      font-family: inherit;
    }
    om-documentation-editor button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    om-documentation-editor .om-doc-tabs button[aria-selected="true"],
    om-documentation-editor .om-doc-format button.is-active {
      background: var(
        --vscode-toolbar-activeBackground,
        var(--om-doc-active-fallback)
      );
      border-color: var(--vscode-focusBorder, transparent);
    }
    om-documentation-editor .om-doc-linkbar {
      display: flex;
      gap: var(--om-doc-control-gap);
      padding: var(--om-doc-gap) var(--om-doc-pad);
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
    }
    om-documentation-editor .om-doc-linkinput {
      flex: 1 1 auto;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: var(--om-doc-control-radius);
      padding: var(--om-doc-control-pad-block) var(--om-doc-control-pad-inline);
    }
    om-documentation-editor .om-doc-editor,
    om-documentation-editor .om-doc-source {
      flex: 1 1 auto;
      overflow: auto;
      padding: var(--om-doc-pad);
    }
    om-documentation-editor .om-doc-editor .ProseMirror {
      min-height: 100%;
      outline: none;
      line-height: 1.5;
      max-width: var(--om-doc-measure);
    }
    om-documentation-editor .om-doc-editor a {
      color: var(--vscode-textLink-foreground);
    }
    om-documentation-editor .om-doc-editor code,
    om-documentation-editor .om-doc-editor pre {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background);
    }
    om-documentation-editor .om-doc-editor pre {
      padding: var(--om-doc-gap);
      overflow-x: auto;
    }
    om-documentation-editor .om-doc-editor table {
      border-collapse: collapse;
    }
    om-documentation-editor .om-doc-editor th,
    om-documentation-editor .om-doc-editor td {
      border: 1px solid var(--vscode-editorWidget-border, currentColor);
      padding: var(--om-doc-control-pad-block) var(--om-doc-gap);
    }
    om-documentation-editor .om-doc-editor img {
      max-width: 100%;
    }
    om-documentation-editor .om-doc-source {
      resize: none;
      border: none;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre;
    }
    om-documentation-editor .om-doc-source:focus,
    om-documentation-editor .om-doc-editor .ProseMirror:focus {
      outline: none;
    }
    om-documentation-editor [hidden] {
      display: none !important;
    }
  </style>
`;

declare global {
  interface HTMLElementTagNameMap {
    "om-documentation-editor": OmDocumentationEditor;
  }
}
