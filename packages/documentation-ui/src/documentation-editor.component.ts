import { Editor } from "@tiptap/core";
import {
  LitElement,
  html,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  DocumentationChangeDetail,
  DocumentationOpenLinkDetail,
} from "./events.js";
import { ORIGINAL_SRC_DATASET } from "./documentation-image.js";
import {
  formatBody,
  splitInfoWrapper,
  wrapInfo,
  type InfoParts,
} from "./documentation-roundtrip.js";
import { documentationExtensions } from "./documentation-schema.js";

/** Coalesce a burst of keystrokes into one change once the editor settles. */
export const EDIT_DEBOUNCE_MS = 300;

/** The follow-a-link modifier label for the current platform. */
function followModifier(): string {
  const platform =
    typeof navigator === "undefined" ? "" : navigator.platform || "";
  return /Mac|iPhone|iPad/i.test(platform) ? "⌘" : "Ctrl";
}

/**
 * WYSIWYG editor for a Modelica class's `Documentation(info="<html>…</html>")`.
 * A pure renderer: it takes `info` in and emits `om-documentation-change` out
 * (the canonical, pretty-printed HTML), with no host dependency, so the same
 * element serves the VSCode custom editor and a web client.
 *
 * TipTap parses HTML against an explicit schema, so the editor also *is* the
 * sanitizer — it only ever renders a parsed ProseMirror document, never a raw
 * HTML string. The "Edit HTML" button toggles a built-in inline `<pre>` of the
 * pretty-printed source; a host that has its own raw-HTML editor sets
 * `external-source`, and the button then emits `om-documentation-edit-source`
 * instead (in VSCode, to open a native HTML editor).
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
  /** Map of image `src` → loadable URI (a `modelica://` resource → `data:` URI). */
  @property({ attribute: false }) resources: Record<string, string> = {};
  @property({ type: Boolean, reflect: true }) readOnly = false;
  /**
   * The host provides its own raw-HTML editor (in VSCode, a native HTML text
   * editor): the "Edit HTML" button then emits `om-documentation-edit-source`
   * instead of toggling the built-in inline `<pre>` source view.
   */
  @property({ type: Boolean, attribute: "external-source" })
  externalSource = false;
  /**
   * The host page owns scrolling: the panes give up their internal overflow
   * and contribute natural height, and the header (toolbar + link bar) sticks
   * to the page's scrollport. Off, the editor fills its container and the
   * content pane scrolls on its own.
   */
  @property({ type: Boolean, reflect: true, attribute: "host-scroll" })
  hostScroll = false;

  @state() private linkEditing = false;
  @state() private linkDraft = "";
  /** Inline `<pre>` source view is showing (only when no external editor). */
  @state() private showSource = false;

  private parts: InfoParts = { prefix: "", inner: "", suffix: "" };
  private editor: Editor | null = null;
  private editTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingChange: (() => string) | undefined;
  // Set while a programmatic `setContent` runs. `emitUpdate: false` does not
  // reliably suppress `onUpdate` on a mounted view, and a load transaction that
  // reached `onEditorUpdate` would emit a spurious change back to the host.
  private loading = false;

  private get editorHost(): HTMLElement | null {
    return this.renderRoot.querySelector(".om-doc-editor");
  }

  private get sourcePre(): HTMLElement | null {
    return this.renderRoot.querySelector(".om-doc-source");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Flush, don't drop: the last ≤300 ms of typing would otherwise be lost when
    // the panel is disposed. The listener is on this element, so a dispatch from
    // a just-disconnected element still reaches the host.
    this.flushChange();
    const host = this.editorHost;
    host?.removeEventListener("click", this.onEditorClick);
    host?.removeEventListener("mouseover", this.onEditorMouseOver);
    this.editor?.destroy();
    this.editor = null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Apply the resolver before (re)loading so image node views render the
    // resolved `src` on first paint rather than flashing broken.
    if (changed.has("resources")) this.applyImageResolver();
    if (changed.has("info")) {
      this.parts = splitInfoWrapper(this.info);
      this.loadIntoEditor();
      // A visible source view would otherwise show stale text that "Done" then
      // re-parses back into the editor.
      if (this.showSource) this.refreshSourceView();
    } else if (changed.has("readOnly")) {
      this.editor?.setEditable(!this.readOnly);
    }
  }

  override firstUpdated(): void {
    const host = this.editorHost;
    if (host === null) return;
    host.addEventListener("click", this.onEditorClick);
    host.addEventListener("mouseover", this.onEditorMouseOver);
    this.editor = new Editor({
      element: host,
      extensions: documentationExtensions,
      editable: !this.readOnly,
      onUpdate: () => this.onEditorUpdate(),
      onTransaction: () => this.requestUpdate(),
    });
    this.applyImageResolver();
    this.loadIntoEditor();
  }

  // Follow a `modelica://` cross-reference: on a plain click when read-only, or
  // a modifier-click while editing (a plain click there places the caret). The
  // host resolves the target; the link's href stays `modelica://` in the source.
  private readonly onEditorClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const href = target.closest("a[href]")?.getAttribute("href");
    if (href === null || href === undefined || !/^modelica:\/\//i.test(href)) {
      return;
    }
    if (!this.readOnly && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent<DocumentationOpenLinkDetail>(
        "om-documentation-open-link",
        {
          detail: { href },
          bubbles: true,
          composed: true,
        },
      ),
    );
  };

  // Set a display-only tooltip on hovered `modelica://` links — it lives on the
  // live DOM, never the ProseMirror model, so it stays out of `getHTML()`/the
  // source. Re-set on every hover so a `readOnly` flip updates the wording.
  // Plain click follows only when read-only; while editing it takes the modifier.
  private readonly onEditorMouseOver = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a[href]");
    if (!(link instanceof HTMLElement)) return;
    const href = link.getAttribute("href");
    if (href === null || !/^modelica:\/\//i.test(href)) return;
    link.title = this.readOnly
      ? `Click to open ${href}`
      : `${followModifier()}-click to open ${href}`;
  };

  /**
   * Point the image node view's resolver at the current `resources` map, and
   * re-resolve any already-rendered image so a `resources` change without a doc
   * reload (its library only now resolves) repaints without a stale broken src.
   */
  private applyImageResolver(): void {
    const storage = this.editor?.storage.image;
    if (storage) storage.resolveSrc = (src) => this.resources[src] ?? src;
    this.editorHost
      ?.querySelectorAll<HTMLImageElement>("img[data-om-original-src]")
      .forEach((img) => {
        const original = img.dataset[ORIGINAL_SRC_DATASET];
        if (original !== undefined) {
          img.setAttribute("src", this.resources[original] ?? original);
        }
      });
  }

  /**
   * Seed the editor from `info` without emitting an update — loading is not a
   * user edit, so it must not emit one back and dirty the host's buffer.
   */
  private loadIntoEditor(): void {
    if (!this.editor) return;
    this.loading = true;
    try {
      this.editor.setEditable(!this.readOnly);
      this.editor.commands.setContent(this.parts.inner, { emitUpdate: false });
    } finally {
      this.loading = false;
    }
  }

  /** The canonical, wrapper-preserved, pretty-printed `info` for the live doc. */
  private serialize(): string {
    if (!this.editor) return this.info;
    return wrapInfo(formatBody(this.editor.getHTML()), this.parts);
  }

  private onEditorUpdate(): void {
    if (!this.editor || this.loading) return;
    this.scheduleChange(() => this.serialize());
  }

  private scheduleChange(getInfo: () => string): void {
    this.pendingChange = getInfo;
    if (this.editTimer !== undefined) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => this.flushChange(), EDIT_DEBOUNCE_MS);
  }

  private flushChange(): void {
    if (this.editTimer !== undefined) {
      clearTimeout(this.editTimer);
      this.editTimer = undefined;
    }
    const getInfo = this.pendingChange;
    this.pendingChange = undefined;
    if (!getInfo) return;
    this.dispatchEvent(
      new CustomEvent<DocumentationChangeDetail>("om-documentation-change", {
        detail: { info: getInfo() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private refreshSourceView(): void {
    void this.updateComplete.then(() => {
      const pre = this.sourcePre;
      if (pre) pre.textContent = this.serialize();
    });
  }

  /**
   * Toggle the built-in inline source view — a `<pre>` of the pretty-printed
   * HTML, editable unless read-only. Used when the host has no external editor
   * (the web path). Its content is set imperatively so a re-render can't clobber
   * the caret; a raw edit is emitted verbatim (the Source escape hatch) and, on
   * switch back, re-parsed into the WYSIWYG editor (out-of-schema tags drop).
   */
  private toggleSource(): void {
    if (this.showSource) {
      const text = this.sourcePre?.textContent ?? "";
      this.parts = splitInfoWrapper(text);
      this.showSource = false;
      this.loadIntoEditor();
      return;
    }
    this.showSource = true;
    this.refreshSourceView();
  }

  private readonly onSourceInput = (): void => {
    const pre = this.sourcePre;
    if (pre) this.scheduleChange(() => pre.textContent ?? "");
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

  private emitEditSource(): void {
    this.dispatchEvent(
      new CustomEvent("om-documentation-edit-source", {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult {
    return html`
      ${STYLE}
      <div class="om-doc-header">
        <div class="om-doc-toolbar">
          ${!this.readOnly && !this.showSource
            ? this.renderFormatButtons()
            : null}
          ${this.renderSourceButton()}
          ${this.readOnly
            ? html`<span class="om-doc-badge">Read-only</span>`
            : null}
        </div>
        ${this.linkEditing && !this.showSource ? this.renderLinkInput() : null}
      </div>

      <div class="om-doc-editor" ?hidden=${this.showSource}></div>
      <pre
        class="om-doc-source"
        spellcheck="false"
        ?hidden=${!this.showSource}
        contenteditable=${this.readOnly ? "false" : "plaintext-only"}
        @input=${this.onSourceInput}
      ></pre>
    `;
  }

  private renderSourceButton(): TemplateResult {
    if (this.externalSource) {
      return html`<button
        class="om-doc-source-btn"
        title="Edit the raw HTML in a text editor"
        @click=${() => this.emitEditSource()}
      >
        Edit HTML ↗
      </button>`;
    }
    return html`<button
      class="om-doc-source-btn ${this.showSource ? "is-active" : ""}"
      title="Show the raw HTML"
      @click=${() => this.toggleSource()}
    >
      ${this.showSource ? "Done" : "Edit HTML"}
    </button>`;
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
      /* A flex child defaults to min-width/min-height:auto, which refuses to
         shrink below its content — a wide table or long line then forces the
         whole editor wider than its panel instead of wrapping/scrolling. */
      min-width: 0;
      min-height: 0;
      height: 100%;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    om-documentation-editor .om-doc-header {
      flex: 0 0 auto;
    }
    om-documentation-editor[host-scroll] {
      height: auto;
    }
    om-documentation-editor[host-scroll] .om-doc-editor,
    om-documentation-editor[host-scroll] .om-doc-source {
      overflow: visible;
    }
    om-documentation-editor[host-scroll] .om-doc-header {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      background: var(--vscode-editor-background);
    }
    om-documentation-editor .om-doc-toolbar {
      display: flex;
      align-items: center;
      gap: var(--om-doc-gap);
      padding: var(--om-doc-gap) var(--om-doc-pad);
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
    }
    om-documentation-editor .om-doc-format {
      display: flex;
      gap: var(--om-doc-control-gap);
    }
    om-documentation-editor .om-doc-source-btn {
      margin-inline-start: auto;
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
    om-documentation-editor button.is-active {
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
      min-height: 0;
      min-width: 0;
      overflow: auto;
      padding: var(--om-doc-pad);
    }
    om-documentation-editor .om-doc-source {
      margin: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, inherit);
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    om-documentation-editor .om-doc-source:focus {
      outline: none;
    }
    om-documentation-editor [hidden] {
      display: none;
    }
    om-documentation-editor .om-doc-editor .ProseMirror {
      min-height: 100%;
      outline: none;
      line-height: 1.5;
      max-width: var(--om-doc-measure);
      /* ProseMirror's essential base: wrap long lines and break unbreakable
         tokens (e.g. a long modelica:// href) rather than overflow. */
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    om-documentation-editor .om-doc-editor .ProseMirror > :first-child {
      margin-block-start: 0;
    }
    om-documentation-editor .om-doc-editor .ProseMirror p,
    om-documentation-editor .om-doc-editor .ProseMirror ul,
    om-documentation-editor .om-doc-editor .ProseMirror ol,
    om-documentation-editor .om-doc-editor .ProseMirror blockquote,
    om-documentation-editor .om-doc-editor .ProseMirror table {
      margin-block: var(--om-doc-gap);
    }
    om-documentation-editor .om-doc-editor .ProseMirror h1,
    om-documentation-editor .om-doc-editor .ProseMirror h2,
    om-documentation-editor .om-doc-editor .ProseMirror h3,
    om-documentation-editor .om-doc-editor .ProseMirror h4 {
      margin-block: var(--om-doc-pad) var(--om-doc-gap);
      line-height: 1.25;
    }
    om-documentation-editor .om-doc-editor .ProseMirror ul,
    om-documentation-editor .om-doc-editor .ProseMirror ol {
      padding-inline-start: 1.5rem;
    }
    om-documentation-editor .om-doc-editor .ProseMirror blockquote {
      margin-inline: 0;
      padding-inline-start: var(--om-doc-pad);
      border-inline-start: 3px solid
        var(--vscode-editorWidget-border, currentColor);
    }
    om-documentation-editor .om-doc-editor a {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
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
    om-documentation-editor .om-doc-editor .ProseMirror:focus {
      outline: none;
    }
  </style>
`;

declare global {
  interface HTMLElementTagNameMap {
    "om-documentation-editor": OmDocumentationEditor;
  }
}
