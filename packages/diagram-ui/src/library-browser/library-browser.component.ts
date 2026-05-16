/**
 * `<om-library-browser>` — modal overlay for browsing loaded Modelica
 * libraries and picking a class to instantiate.
 *
 * Built on Web Awesome (`<wa-dialog>` + `<wa-tree>` + `<wa-tree-item>`
 * + `<wa-input>`). The component is data-source-driven: it knows
 * nothing about OMC. The embedder supplies a
 * `LibraryBrowserDataSource` that wraps `getClassNames` /
 * `getClassRestriction` (or any equivalent), and the browser handles
 * tree expansion + flat search on top of it.
 *
 *   - empty search → tree mode: roots from `listChildren(null)`,
 *     children lazy-loaded by wa-tree-item on first expand.
 *   - non-empty search → flat list from `searchAll(query)` (debounced).
 *
 * Events:
 *   - `om-library-select` { detail: { className: string } } — emitted
 *     on tree-item activation. The host should call OMC `addComponent`
 *     (or whatever) in response. Selecting also closes the overlay.
 *   - `om-library-cancel` — Escape key, backdrop click, or the X
 *     button (forwarded from wa-dialog's `wa-hide`).
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/tree/tree.js";
import "@awesome.me/webawesome/dist/components/tree-item/tree-item.js";
import type WaDialog from "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import type WaTreeItem from "@awesome.me/webawesome/dist/components/tree-item/tree-item.js";

/**
 * Modelica class restrictions surfaced in the palette. Mirrors OMC's
 * `getClassRestriction` output, plus an `"unknown"` fallback for
 * implementations that can't (or don't want to) resolve the kind.
 */
export type LibraryClassRestriction =
  | "package"
  | "model"
  | "block"
  | "class"
  | "connector"
  | "expandable connector"
  | "record"
  | "function"
  | "type"
  | "operator"
  | "operator function"
  | "operator record"
  | "unknown";

/**
 * One row in a `listChildren` / `searchAll` response. The component
 * uses the restriction both to pick an icon and to decide whether the
 * row should be lazy-expandable — only `package` (and `unknown` as a
 * safe default) is treated as a container in the palette.
 */
export interface LibraryClassInfo {
  /** Fully qualified dotted name (e.g. `Modelica.Blocks.Math.Gain`). */
  qualified: string;
  /** Modelica class restriction; drives icon + expandability. */
  restriction: LibraryClassRestriction;
}

/**
 * Pluggable data source. Errors thrown by either method surface in the
 * UI as an inline message; the overlay stays open so the user can
 * retry.
 */
export interface LibraryBrowserDataSource {
  /**
   * List immediate child classes of `parent`. Pass `null` for the
   * loaded top-level classes (OMC's `AllLoadedClasses`).
   */
  listChildren(parent: string | null): Promise<LibraryClassInfo[]>;
  /**
   * Return qualified class names matching `query`. The component
   * debounces user input before calling this, but the implementation
   * is responsible for any backend-side query optimisation.
   */
  searchAll(query: string): Promise<LibraryClassInfo[]>;
}

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Tree expansion is restricted to `package` (the only Modelica
 * restriction whose primary role is to *contain* other classes). The
 * `unknown` fallback is also treated as expandable so a data source
 * that hasn't resolved the kind yet doesn't accidentally orphan its
 * children.
 */
function isExpandable(r: LibraryClassRestriction): boolean {
  return r === "package" || r === "unknown";
}

interface IconStyle {
  /** Single-character glyph rendered in the badge. */
  glyph: string;
  /** Foreground colour of the glyph. */
  fg: string;
  /** Background colour of the badge. */
  bg: string;
}

/**
 * Map a Modelica restriction to a coloured letter badge. Colours
 * follow loose VSCode symbol-kind conventions: blue=package,
 * purple=class/model, green=block, orange=connector, red=function,
 * yellow=record/type.
 */
function iconStyleFor(r: LibraryClassRestriction): IconStyle {
  switch (r) {
    case "package":
      return { glyph: "P", fg: "#fff", bg: "#3b82f6" };
    case "model":
      return { glyph: "M", fg: "#fff", bg: "#7c3aed" };
    case "block":
      return { glyph: "B", fg: "#fff", bg: "#10b981" };
    case "class":
      return { glyph: "C", fg: "#fff", bg: "#64748b" };
    case "connector":
    case "expandable connector":
      return { glyph: "K", fg: "#fff", bg: "#f59e0b" };
    case "record":
      return { glyph: "R", fg: "#1f1f1f", bg: "#fde68a" };
    case "function":
    case "operator function":
      return { glyph: "ƒ", fg: "#fff", bg: "#ef4444" };
    case "type":
      return { glyph: "T", fg: "#1f1f1f", bg: "#bae6fd" };
    case "operator":
    case "operator record":
      return { glyph: "O", fg: "#fff", bg: "#0ea5e9" };
    case "unknown":
    default:
      return { glyph: "?", fg: "#fff", bg: "#9ca3af" };
  }
}

/**
 * Tree-item state held in light DOM. `qualified` and `restriction` are
 * mirrored onto data-attributes so the wa-tree's selection event can
 * round-trip them back without a parallel lookup table.
 */
interface RootNode {
  qualified: string;
  restriction: LibraryClassRestriction;
}

@customElement("om-library-browser")
export class OmLibraryBrowser extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }

    /* Search input + tree share the dialog body's vertical rhythm. */
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-s, 8px);
      min-height: 320px;
    }

    .empty,
    .loading,
    .error {
      padding: var(--wa-space-m, 12px);
      color: var(--wa-color-text-quiet, #666);
      font-size: 0.92em;
    }

    .error {
      color: var(--wa-color-danger-fill-loud, #c33);
    }

    /* Row content inside each wa-tree-item: icon badge + label, with
     * an optional qualifier (used by search results to show the
     * dotted path prefix). */
    .row {
      display: inline-flex;
      align-items: center;
      gap: var(--wa-space-xs, 4px);
    }

    .icon {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 2px;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      font-family: var(--wa-font-family-code, ui-monospace, monospace);
    }

    .qualifier {
      font-size: 0.85em;
      color: var(--wa-color-text-quiet, #666);
      margin-left: var(--wa-space-xs, 4px);
    }

    .node-error {
      padding: var(--wa-space-2xs, 2px) var(--wa-space-m, 12px);
      color: var(--wa-color-danger-fill-loud, #c33);
      font-size: 0.85em;
    }
  `;

  /** Whether the modal is shown. */
  @property({ type: Boolean, reflect: true })
  open = false;

  /** Title shown in the dialog header. */
  @property() override title = "Add component";

  /**
   * Data source. When `null` (default) the browser renders an "no
   * data source configured" message — useful in stories where the
   * embedder has not wired anything up yet.
   */
  @property({ attribute: false })
  dataSource: LibraryBrowserDataSource | null = null;

  @state() private roots: RootNode[] | null = null;
  @state() private rootsLoading = false;
  @state() private rootsError: string | null = null;

  @state() private query = "";
  @state() private searchResults: LibraryClassInfo[] | null = null;
  @state() private searchLoading = false;
  @state() private searchError: string | null = null;

  @query("wa-dialog") private dialogEl?: WaDialog;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;
  /** Per-node error message keyed by qualified name. */
  private nodeErrors = new Map<string, string>();

  override disconnectedCallback(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>): void {
    // Trigger initial root load the first time the modal opens with a
    // data source attached. Reloading on every re-open would discard
    // user expansion state, so we keep results once fetched.
    if ((changed.has("open") || changed.has("dataSource")) && this.open) {
      if (this.dataSource && this.roots === null && !this.rootsLoading) {
        void this.loadRoots();
      }
    }
  }

  override render(): TemplateResult {
    // Only mount the wa-dialog (and the wa-input + wa-button it
    // implies) while the modal is open. wa components are
    // form-associated and rely on ElementInternals APIs that aren't
    // available under happy-dom's test environment — keeping them
    // out of the DOM until the user actually opens the browser keeps
    // both tests and idle-page memory clean.
    if (!this.open) return html`${nothing}`;
    return html`
      <wa-dialog
        open
        label=${this.title}
        light-dismiss
        @wa-hide=${this.onDialogHide}
      >
        <div class="body">
          <wa-input
            type="search"
            placeholder="Search loaded libraries…"
            .value=${this.query}
            @input=${this.onSearchInput}
            autofocus
          ></wa-input>
          ${this.renderBody()}
        </div>
      </wa-dialog>
    `;
  }

  private renderBody(): TemplateResult {
    if (!this.dataSource) {
      return html`<div class="empty">No library data source configured.</div>`;
    }
    if (this.query.trim().length > 0) {
      return this.renderSearchResults();
    }
    return this.renderTree();
  }

  private renderTree(): TemplateResult {
    if (this.rootsLoading && this.roots === null) {
      return html`<div class="loading">Loading libraries…</div>`;
    }
    if (this.rootsError) {
      return html`<div class="error">${this.rootsError}</div>`;
    }
    const roots = this.roots ?? [];
    if (roots.length === 0) {
      return html`<div class="empty">No loaded classes.</div>`;
    }
    return html`
      <wa-tree
        selection="single"
        @wa-selection-change=${this.onSelectionChange}
        @wa-lazy-load=${this.onLazyLoad}
      >
        ${repeat(
          roots,
          (n) => n.qualified,
          (n) => this.renderRootItem(n),
        )}
      </wa-tree>
    `;
  }

  /**
   * Render a top-level wa-tree-item. Children are appended in light
   * DOM at lazy-load time — we don't pre-render placeholders because
   * wa-tree-item shows the expand chevron purely based on the presence
   * of nested wa-tree-item children + the `lazy` attribute.
   */
  private renderRootItem(node: RootNode): TemplateResult {
    const expandable = isExpandable(node.restriction);
    return html`<wa-tree-item
      ?lazy=${expandable}
      data-qualified=${node.qualified}
      data-restriction=${node.restriction}
    >
      ${this.renderRow(node.qualified, node.restriction)}
    </wa-tree-item>`;
  }

  private renderRow(
    qualified: string,
    restriction: LibraryClassRestriction,
  ): TemplateResult {
    const label = qualified.slice(qualified.lastIndexOf(".") + 1) || qualified;
    return this.renderLabelledRow(label, restriction);
  }

  private renderLabelledRow(
    label: string,
    restriction: LibraryClassRestriction,
    qualifier?: string,
  ): TemplateResult {
    const style = iconStyleFor(restriction);
    return html`<span class="row">
      <span
        class="icon"
        style=${`color: ${style.fg}; background: ${style.bg};`}
        title=${restriction}
        >${style.glyph}</span
      >
      <span>${label}</span>
      ${qualifier
        ? html`<span class="qualifier">${qualifier}</span>`
        : nothing}
    </span>`;
  }

  private renderSearchResults(): TemplateResult {
    if (this.searchLoading && this.searchResults === null) {
      return html`<div class="loading">Searching…</div>`;
    }
    if (this.searchError) {
      return html`<div class="error">${this.searchError}</div>`;
    }
    const results = this.searchResults ?? [];
    if (results.length === 0) {
      return html`<div class="empty">No matches.</div>`;
    }
    return html`
      <wa-tree
        selection="single"
        @wa-selection-change=${this.onSelectionChange}
      >
        ${repeat(
          results,
          (info) => info.qualified,
          (info) => {
            const q = info.qualified;
            const dot = q.lastIndexOf(".");
            const head = dot >= 0 ? q.slice(0, dot) : "";
            const tail = dot >= 0 ? q.slice(dot + 1) : q;
            return html`<wa-tree-item
              data-qualified=${q}
              data-restriction=${info.restriction}
            >
              ${this.renderLabelledRow(tail, info.restriction, head)}
            </wa-tree-item>`;
          },
        )}
      </wa-tree>
    `;
  }

  /**
   * wa-tree-item fires `wa-lazy-load` on the first expand. We attach
   * children directly to the event target, then drop the `lazy`
   * attribute so the loading spinner disappears.
   *
   * Errors are surfaced as a synthetic `<div class="node-error">`
   * appended next to the children — wa-tree-item will still treat the
   * item as expanded, just with the error visible inside.
   */
  private async onLazyLoad(e: Event): Promise<void> {
    const item = e.target as WaTreeItem | null;
    if (!item || !this.dataSource) return;
    const qualified = item.dataset["qualified"] ?? "";
    if (!qualified) return;
    this.nodeErrors.delete(qualified);
    try {
      const infos = await this.dataSource.listChildren(qualified);
      // Build the children as detached DOM, then append in one shot
      // to minimise wa-tree-item's mutation-observer churn.
      const frag = document.createDocumentFragment();
      for (const info of infos) {
        const fullyQualified = info.qualified.includes(".")
          ? info.qualified
          : `${qualified}.${info.qualified}`;
        const child = document.createElement("wa-tree-item");
        if (isExpandable(info.restriction)) {
          child.setAttribute("lazy", "");
        }
        child.dataset["qualified"] = fullyQualified;
        child.dataset["restriction"] = info.restriction;
        child.appendChild(this.buildRowElement(fullyQualified, info.restriction));
        frag.appendChild(child);
      }
      item.appendChild(frag);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.nodeErrors.set(qualified, msg);
      const errEl = document.createElement("div");
      errEl.className = "node-error";
      errEl.textContent = msg;
      item.appendChild(errEl);
    } finally {
      item.removeAttribute("lazy");
    }
  }

  /**
   * Imperative builder for tree-item children — used by the lazy-load
   * path which appends to existing wa-tree-items rather than going
   * through Lit's render. Mirrors `renderRow` but produces real DOM
   * nodes instead of a template.
   */
  private buildRowElement(
    qualified: string,
    restriction: LibraryClassRestriction,
  ): HTMLElement {
    const label =
      qualified.slice(qualified.lastIndexOf(".") + 1) || qualified;
    const style = iconStyleFor(restriction);
    const row = document.createElement("span");
    row.className = "row";
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.style.color = style.fg;
    icon.style.background = style.bg;
    icon.title = restriction;
    icon.textContent = style.glyph;
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    row.appendChild(icon);
    row.appendChild(labelEl);
    return row;
  }

  private onSelectionChange = (e: Event): void => {
    const detail = (e as CustomEvent<{ selection: WaTreeItem[] }>).detail;
    const selected = detail?.selection?.[0];
    if (!selected) return;
    const qualified = selected.dataset["qualified"];
    if (!qualified) return;
    // Clear the wa-tree's selection so re-opening the dialog doesn't
    // come back with the previous pick highlighted.
    selected.selected = false;
    this.fireSelect(qualified);
  };

  private onSearchInput = (e: Event): void => {
    const value = (e.target as HTMLInputElement).value;
    this.query = value;
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (value.trim().length === 0) {
      this.searchResults = null;
      this.searchError = null;
      this.searchLoading = false;
      return;
    }
    this.searchLoading = true;
    this.searchTimer = setTimeout(() => {
      void this.runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  private async runSearch(query: string): Promise<void> {
    if (!this.dataSource) return;
    const seq = ++this.searchSeq;
    try {
      const results = await this.dataSource.searchAll(query);
      // Drop stale responses — the user has typed more since this
      // request was issued. Otherwise an older slow query could
      // overwrite the latest results.
      if (seq !== this.searchSeq) return;
      this.searchResults = results;
      this.searchError = null;
    } catch (err) {
      if (seq !== this.searchSeq) return;
      this.searchError = err instanceof Error ? err.message : String(err);
      this.searchResults = null;
    } finally {
      if (seq === this.searchSeq) {
        this.searchLoading = false;
      }
    }
  }

  private async loadRoots(): Promise<void> {
    if (!this.dataSource) return;
    this.rootsLoading = true;
    this.rootsError = null;
    try {
      const infos = await this.dataSource.listChildren(null);
      this.roots = infos.map((info) => ({
        qualified: info.qualified,
        restriction: info.restriction,
      }));
    } catch (err) {
      this.rootsError = err instanceof Error ? err.message : String(err);
    } finally {
      this.rootsLoading = false;
    }
  }

  /**
   * Maps wa-dialog's hide event back onto our `open` property +
   * `om-library-cancel` event. `wa-hide` is cancellable; we don't
   * cancel.
   */
  private onDialogHide = (e: Event): void => {
    // Only react to closures from inside the dialog (backdrop click,
    // Escape, X). Programmatic close via setting our `open` prop will
    // also fire wa-hide on the wa-dialog, but that's fine — we'll
    // just toggle our own state to match what's already happening.
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      this.dispatchEvent(
        new CustomEvent("om-library-cancel", {
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  private fireSelect(className: string): void {
    this.open = false;
    // Closing the host wa-dialog imperatively so the next time it
    // opens, we don't re-trigger animations from a half-open state.
    if (this.dialogEl) {
      this.dialogEl.open = false;
    }
    this.dispatchEvent(
      new CustomEvent<{ className: string }>("om-library-select", {
        detail: { className },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-library-browser": OmLibraryBrowser;
  }
}
