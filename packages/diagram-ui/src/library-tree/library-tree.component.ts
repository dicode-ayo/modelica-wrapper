/**
 * `<om-library-tree>` — reusable, virtualized browser for loaded Modelica
 * libraries, built on `@headless-tree/core` (`asyncDataLoaderFeature`) with
 * rows rendered in our own Lit and virtualized by `<lit-virtualizer>`.
 *
 * Data-source driven: the component knows nothing about OMC. The embedder
 * supplies a `LibraryBrowserDataSource` (the same contract
 * `<om-library-browser>` consumes) and the tree handles lazy expansion, flat
 * search, per-class icons, selection, and drag payloads on top of it.
 *
 *   - empty search → tree mode: top-level classes from `listChildren(null)`,
 *     children lazy-loaded on first expand.
 *   - non-empty search → flat list from `searchAll(query)` (debounced), with
 *     the matched substring highlighted.
 *
 * Events:
 *   - `om-library-select` { detail: { className } } — emitted on row
 *     activation (click / Enter). Same event `<om-library-browser>` emits.
 *
 * Rows are draggable and carry `{ className }` on the drag `DataTransfer`
 * under `LIBRARY_TREE_DRAG_FORMAT`, ready for a drop-to-instantiate handler.
 */

import {
  LitElement,
  css,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";

import {
  asyncDataLoaderFeature,
  createTree,
  dragAndDropFeature,
  hotkeysCoreFeature,
  selectionFeature,
  type ItemInstance,
  type TreeInstance,
} from "@headless-tree/core";
import "@lit-labs/virtualizer";

import { omTokens } from "@dicode/ui-common";

import type {
  LibraryBrowserDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
  LibraryEvents,
} from "../library-browser/library-browser.component.js";
import { bindItemProps } from "./bind-item-props.js";
import { iconStyleFor } from "./restriction-icon.js";
import {
  LIBRARY_TREE_ROOT_ID,
  createLibraryDataLoader,
  isExpandable,
  leafLabel,
  matchLabel,
  type LibraryTreeNode,
} from "./library-tree-model.js";

/** `DataTransfer` type carrying `{ className }` on a dragged row. */
export const LIBRARY_TREE_DRAG_FORMAT = "application/x-om-library-class";

const SEARCH_DEBOUNCE_MS = 200;

/** Serialise the drag payload for a class row (foreign-drop consumers). */
function dragPayload(className: string): string {
  return JSON.stringify({ className });
}

@customElement("om-library-tree")
export class OmLibraryTree extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--om-space-md);
        /* Clip to the slot the embedder gives us so rows scroll internally
         * instead of pushing past a bounded flex parent. */
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, var(--om-tree-font-size));
        color: var(--vscode-foreground);
      }

      .search {
        padding: var(--om-input-padding);
        font: inherit;
        color: inherit;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: var(--om-radius-md);
      }

      /* The scroller attribute (set on the element) makes the virtualizer its
       * own scroll container — without it a virtualizer scrolls an ancestor and
       * sizes to full content, so it can't bound itself. flex-basis 0 sizes the
       * scroll box to the slot, not its content. */
      lit-virtualizer {
        flex: 1 1 0;
        min-height: 0;
      }

      .empty,
      .loading,
      .error {
        padding: var(--om-space-lg);
        color: var(--vscode-descriptionForeground);
        font-size: var(--om-description-size);
      }
      .error {
        color: var(--vscode-errorForeground);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--om-space-xs);
        height: var(--om-tree-row-height);
        line-height: var(--om-tree-row-height);
        white-space: nowrap;
        cursor: grab;
        user-select: none;
        /* Fill the row so hover / selection span its full width, not just the
         * icon+label content. */
        width: 100%;
        box-sizing: border-box;

        &:hover {
          background: var(--vscode-list-hoverBackground);
        }
        &[data-selected="true"] {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground, inherit);
        }
      }

      .indent {
        flex: 0 0 auto;
        width: calc(var(--om-tree-level, 0) * var(--om-tree-indent));
      }
      .chevron,
      .leaf-dot {
        flex: 0 0 auto;
        width: var(--om-icon-size-md);
        text-align: center;
        color: var(--vscode-icon-foreground, currentColor);
      }
      .leaf-dot {
        opacity: var(--om-disabled-opacity);
      }

      .icon {
        flex: 0 0 auto;
        width: var(--om-icon-size-md);
        height: var(--om-icon-size-md);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--om-radius-sm);
        font-size: var(--om-badge-font-size);
        font-weight: var(--om-badge-font-weight);
        line-height: 1;
        font-family: var(--vscode-editor-font-family, ui-monospace, monospace);

        &.icon-svg {
          background: none;
          border-radius: 0;

          & svg {
            width: 100%;
            height: 100%;
          }
        }
      }

      .label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;

        &.loading {
          opacity: var(--om-disabled-opacity);
          font-style: italic;
        }
      }
      .qualifier {
        font-size: var(--om-qualifier-size);
        color: var(--vscode-descriptionForeground);
        margin-left: var(--om-space-xs);
      }
      mark {
        background: var(--vscode-editor-findMatchHighlightBackground);
        color: inherit;
      }
    `,
  ];

  /** Data source; `null` renders a "no data source configured" message. */
  @property({ attribute: false })
  dataSource: LibraryBrowserDataSource | null = null;

  @state() private query = "";
  @state() private searchResults: LibraryClassInfo[] | null = null;
  @state() private searchLoading = false;
  @state() private searchError: string | null = null;

  private tree: TreeInstance<LibraryTreeNode> | undefined;
  private readonly nodeCache = new Map<string, LibraryTreeNode>();

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  /** Rendered icon SVG keyed by qualified name (lazy per row). */
  private readonly iconSvgCache = new Map<string, string>();
  /** Qualified names whose icon fetch has already been kicked off. */
  private readonly iconRequested = new Set<string>();

  override disconnectedCallback(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    super.disconnectedCallback();
  }

  // Building the tree here (not in `updated`) keeps Headless Tree's
  // `setState` re-render calls inside the update cycle, so they never
  // schedule a post-commit `requestUpdate` — which would loop.
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("dataSource")) {
      this.rebuildForDataSource();
    }
  }

  private rebuildForDataSource(): void {
    this.nodeCache.clear();
    this.iconSvgCache.clear();
    this.iconRequested.clear();
    // A source swap invalidates any search against the previous source.
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchSeq++;
    this.query = "";
    this.searchResults = null;
    this.searchLoading = false;
    this.searchError = null;
    const source = this.dataSource;
    if (!source) {
      this.tree = undefined;
      return;
    }
    this.tree = createTree<LibraryTreeNode>({
      rootItemId: LIBRARY_TREE_ROOT_ID,
      getItemName: (item) => item.getItemData().label,
      isItemFolder: (item) => isExpandable(item.getItemData().restriction),
      createLoadingItemData: () => ({
        className: "",
        label: "Loading…",
        restriction: "unknown",
      }),
      dataLoader: createLibraryDataLoader(source, this.nodeCache),
      onPrimaryAction: (item) => this.fireSelect(item.getItemData().className),
      canDrag: (items) =>
        items.every((item) => item.getItemData().className !== ""),
      createForeignDragObject: (items) => ({
        format: LIBRARY_TREE_DRAG_FORMAT,
        data: dragPayload(items.at(0)?.getItemData().className ?? ""),
        effectAllowed: "copy",
      }),
      state: {},
      setState: () => this.requestUpdate(),
      features: [
        asyncDataLoaderFeature,
        selectionFeature,
        hotkeysCoreFeature,
        dragAndDropFeature,
      ],
    });
    this.tree.setMounted(true);
    this.tree.rebuildTree();
  }

  override render(): TemplateResult {
    if (!this.dataSource) {
      return html`<div class="empty">No library data source configured.</div>`;
    }
    return html`
      <input
        class="search"
        type="search"
        placeholder="Search loaded libraries…"
        .value=${this.query}
        @input=${this.onSearchInput}
      />
      ${this.query.trim().length > 0 ? this.renderSearch() : this.renderTree()}
    `;
  }

  private renderTree(): TemplateResult {
    const items = this.tree?.getItems() ?? [];
    if (items.length === 0) {
      return html`<div class="loading">Loading libraries…</div>`;
    }
    return html`
      <lit-virtualizer
        scroller
        .items=${items}
        .keyFunction=${(item: ItemInstance<LibraryTreeNode>) => item.getId()}
        .renderItem=${(item: ItemInstance<LibraryTreeNode>) =>
          this.renderRow(item)}
      ></lit-virtualizer>
    `;
  }

  private renderRow(item: ItemInstance<LibraryTreeNode>): TemplateResult {
    const node = item.getItemData();
    const level = item.getItemMeta().level;
    const loading = item.isLoading();
    const props = item.getProps();
    return html`
      <div
        class="row"
        data-selected=${item.isSelected() ? "true" : "false"}
        ${bindItemProps(props)}
      >
        <span
          class="indent"
          style=${styleMap({ "--om-tree-level": String(level) })}
        ></span>
        ${item.isFolder()
          ? html`<span class="chevron">${item.isExpanded() ? "▾" : "▸"}</span>`
          : html`<span class="leaf-dot">•</span>`}
        ${loading
          ? html`<span class="label loading">Loading…</span>`
          : this.renderClassContent(
              node.className,
              node.restriction,
              node.label,
            )}
      </div>
    `;
  }

  /** Icon + label (+ optional highlighted qualifier), shared by both rows. */
  private renderClassContent(
    className: string,
    restriction: LibraryClassRestriction,
    label: string,
    opts: { highlight?: boolean; qualifier?: string } = {},
  ): TemplateResult {
    return html`
      ${this.renderIcon(className, restriction)}
      <span class="label"
        >${opts.highlight ? this.highlight(label) : label}</span
      >
      ${opts.qualifier
        ? html`<span class="qualifier">${opts.qualifier}</span>`
        : nothing}
    `;
  }

  private renderSearch(): TemplateResult {
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
      <lit-virtualizer
        scroller
        .items=${results}
        .keyFunction=${(info: LibraryClassInfo) => info.qualified}
        .renderItem=${(info: LibraryClassInfo) => this.renderSearchRow(info)}
      ></lit-virtualizer>
    `;
  }

  private renderSearchRow(info: LibraryClassInfo): TemplateResult {
    const q = info.qualified;
    const dot = q.lastIndexOf(".");
    const head = dot >= 0 ? q.slice(0, dot) : "";
    return html`
      <div
        class="row"
        role="option"
        tabindex="0"
        draggable="true"
        @click=${() => this.fireSelect(q)}
        @keydown=${(e: KeyboardEvent) => this.onSearchRowKeydown(e, q)}
        @dragstart=${(e: DragEvent) => this.onSearchRowDragStart(e, q)}
      >
        <span class="leaf-dot">•</span>
        ${this.renderClassContent(q, info.restriction, leafLabel(q), {
          highlight: true,
          qualifier: head,
        })}
      </div>
    `;
  }

  private highlight(label: string): TemplateResult {
    const match = matchLabel(label, this.query.trim());
    if (!match) return html`${label}`;
    return html`${match.before}<mark>${match.match}</mark>${match.after}`;
  }

  /**
   * Rendered class SVG once the lazy `iconSvg` fetch resolves, else the
   * restriction-letter badge. Rendering a row kicks off the fetch as a side
   * effect (idempotent per class name via `requestIcon`).
   */
  private renderIcon(
    className: string,
    restriction: LibraryClassRestriction,
  ): TemplateResult {
    this.requestIcon(className);
    const svg = this.iconSvgCache.get(className);
    if (svg) {
      return html`<span class="icon icon-svg" title=${restriction}
        >${unsafeSVG(svg)}</span
      >`;
    }
    const style = iconStyleFor(restriction);
    return html`<span
      class="icon"
      style=${styleMap({ color: style.fg, background: style.bg })}
      title=${restriction}
      >${style.glyph}</span
    >`;
  }

  /** Fire-and-cache a lazy icon fetch for `className`, at most once. */
  private requestIcon(className: string): void {
    if (!className) return;
    if (!this.dataSource?.iconSvg) return;
    if (this.iconRequested.has(className)) return;
    this.iconRequested.add(className);
    void this.dataSource
      .iconSvg(className)
      .then((svg) => {
        if (svg) {
          this.iconSvgCache.set(className, svg);
          this.requestUpdate();
        }
      })
      .catch(() => {
        // Best-effort — keep the badge on failure.
      });
  }

  // Search rows aren't Headless Tree items, so they don't get the tree's
  // keyboard activation; wire Enter/Space to selection ourselves.
  private onSearchRowKeydown(event: KeyboardEvent, className: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.fireSelect(className);
    }
  }

  // Search rows aren't Headless Tree items, so they can't ride the tree's
  // createForeignDragObject path; carry the same payload manually.
  private onSearchRowDragStart(event: DragEvent, className: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(
      LIBRARY_TREE_DRAG_FORMAT,
      dragPayload(className),
    );
    event.dataTransfer.effectAllowed = "copy";
  }

  private onSearchInput = (e: Event): void => {
    const value = (e.target as HTMLInputElement).value;
    this.query = value;
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (value.trim().length === 0) {
      // Bump the sequence so an in-flight runSearch can't write its result
      // back after the query was cleared.
      this.searchSeq++;
      this.searchResults = null;
      this.searchError = null;
      this.searchLoading = false;
      return;
    }
    this.searchLoading = true;
    const query = value.trim();
    this.searchTimer = setTimeout(() => {
      void this.runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  };

  private async runSearch(query: string): Promise<void> {
    if (!this.dataSource) return;
    const seq = ++this.searchSeq;
    try {
      const results = await this.dataSource.searchAll(query);
      // Drop stale responses — the user has typed more since this request
      // was issued, so an older slow query must not clobber the latest.
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

  private fireSelect(className: string): void {
    if (!className) return;
    this.dispatchEvent(
      new CustomEvent<LibraryEvents["om-library-select"]>("om-library-select", {
        detail: { className },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-library-tree": OmLibraryTree;
  }
}
