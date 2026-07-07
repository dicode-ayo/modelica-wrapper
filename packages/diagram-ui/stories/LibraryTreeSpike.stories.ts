/**
 * SPIKE (throwaway, issue #241 / epic #240) — proves the mechanics of
 * replacing the hand-rolled library tree with `@headless-tree/core`
 * (`asyncDataLoaderFeature`) rows rendered in our own Lit, virtualized by
 * `@lit-labs/virtualizer`. Not production wiring.
 *
 * Rows carry an inline icon (stand-in for the per-class Modelica SVG) and a
 * search box wired to `searchFeature` filters + highlights loaded matches.
 *
 * Three things under test:
 *   1. Lazy + virtualized at scale — a synthetic ~15.5k-node tree whose
 *      children load on expand (async loader + simulated OMC latency). Only
 *      the visible rows exist in the DOM; the header shows the live count.
 *   2. Drag a row onto a sibling `<canvas>` via Headless Tree's foreign-drag
 *      API (`createForeignDragObject` + `onCompleteForeignDrop`) — the drop
 *      reads (x, y) and the dragged node id and paints it. The instantiate
 *      gesture.
 *   3. CSP-safe bundling — neither dep uses `eval` / `new Function`, so a
 *      strict webview CSP won't block them.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import {
  asyncDataLoaderFeature,
  createTree,
  dragAndDropFeature,
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  type ItemInstance,
  type TreeConfig,
  type TreeInstance,
} from "@headless-tree/core";
import "@lit-labs/virtualizer";

interface SpikeNode {
  name: string;
  isFolder: boolean;
}

// Synthetic tree shape: 24 × 24 × 26 ≈ 15.5k nodes when fully expanded.
// A node id is a dot-path ("3.11.7"); depth = the dot count. Everything is
// derived from the id so folder-ness never depends on async-loaded data.
const BRANCHING = [24, 24, 26] as const;
const ROOT = "root";
const DRAG_FORMAT = "text/plain";

const levelOf = (id: string): number =>
  id === ROOT ? 0 : id.split(".").length;
const isFolderId = (id: string): boolean => levelOf(id) < BRANCHING.length;

function childIds(id: string): string[] {
  const count = BRANCHING[levelOf(id)] ?? 0;
  const prefix = id === ROOT ? "" : `${id}.`;
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

function nameFor(id: string): string {
  if (id === ROOT) return "root";
  return `${isFolderId(id) ? "Package" : "Block"} ${id}`;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Simulated OMC round-trip so lazy loading and the loading placeholder are
// observable rather than instantaneous.
const OMC_LATENCY_MS = 140;

interface CanvasDrop {
  id: string;
  name: string;
  x: number;
  y: number;
}

@customElement("om-library-tree-spike")
export class OmLibraryTreeSpike extends LitElement {
  static styles = css`
    :host {
      --om-tree-row-height: 22px;
      --om-tree-indent: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
      color: var(--vscode-foreground, #1f1f1f);
      height: 520px;
    }

    .stats {
      display: flex;
      gap: 16px;
      align-items: baseline;
      padding: 4px 6px;
      background: var(--vscode-editorWidget-background, #f3f3f3);
      border-radius: 4px;
    }
    .stats strong {
      font-variant-numeric: tabular-nums;
    }

    .split {
      display: flex;
      gap: 12px;
      flex: 1;
      min-height: 0;
    }

    lit-virtualizer {
      flex: 1 1 50%;
      overflow: auto;
      border: 1px solid var(--vscode-widget-border, #d0d0d0);
      border-radius: 4px;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 4px;
      height: var(--om-tree-row-height);
      line-height: var(--om-tree-row-height);
      white-space: nowrap;
      cursor: grab;
      user-select: none;
    }
    .row:hover {
      background: var(--vscode-list-hoverBackground, #ececec);
    }
    .row[aria-selected="true"] {
      background: var(--vscode-list-activeSelectionBackground, #cfe3ff);
    }
    .chevron {
      width: 1em;
      text-align: center;
      opacity: 0.7;
    }
    .leaf-dot {
      width: 1em;
      text-align: center;
      opacity: 0.4;
    }
    .loading {
      opacity: 0.55;
      font-style: italic;
    }
    /* Stand-in for the real per-class Modelica icon (reused via the existing
     * lazy onLibraryIcon SVG path in the production component). */
    .icon {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      color: #fff;
    }
    mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ffe58a);
      color: inherit;
    }

    .search {
      padding: 3px 6px;
      font: inherit;
      color: inherit;
      background: var(--vscode-input-background, #fff);
      border: 1px solid var(--vscode-input-border, #ccc);
      border-radius: 4px;
      min-width: 220px;
    }

    canvas {
      flex: 1 1 50%;
      border: 1px dashed var(--vscode-widget-border, #b0b0b0);
      border-radius: 4px;
      background: repeating-linear-gradient(
        45deg,
        #fafafa,
        #fafafa 8px,
        #f0f0f0 8px,
        #f0f0f0 16px
      );
    }
  `;

  @state() private renderedRows = 0;
  @state() private lastDrop: CanvasDrop | undefined;

  @query("canvas") private canvasEl?: HTMLCanvasElement;

  private readonly tree: TreeInstance<SpikeNode>;
  private readonly totalNodes = 1 + 24 + 24 * 24 + 24 * 24 * 26;
  private readonly drops: CanvasDrop[] = [];
  private readonly boundListeners = new WeakMap<
    Element,
    Array<[string, EventListener]>
  >();

  constructor() {
    super();
    const config: TreeConfig<SpikeNode> = {
      rootItemId: ROOT,
      getItemName: (item) => item.getItemData().name,
      isItemFolder: (item) => isFolderId(item.getId()),
      createLoadingItemData: () => ({ name: "Loading…", isFolder: false }),
      dataLoader: {
        getItem: async (itemId: string) => {
          await wait(OMC_LATENCY_MS);
          return { name: nameFor(itemId), isFolder: isFolderId(itemId) };
        },
        getChildren: async (itemId: string) => {
          await wait(OMC_LATENCY_MS);
          return childIds(itemId);
        },
      },
      // A foreign drop hands a node id + name to the canvas; the completion
      // hook fires on the tree side once the external drop lands.
      createForeignDragObject: (items) => {
        const first = items.at(0);
        const id = first?.getId() ?? "";
        const name = first?.getItemName() ?? id;
        return {
          format: DRAG_FORMAT,
          data: JSON.stringify({ id, name }),
          effectAllowed: "copy",
        };
      },
      onCompleteForeignDrop: (items) => {
        const first = items.at(0);
        if (first) console.log("foreign drop completed for", first.getId());
      },
      state: {},
      setState: () => this.requestUpdate(),
      features: [
        asyncDataLoaderFeature,
        selectionFeature,
        hotkeysCoreFeature,
        dragAndDropFeature,
        searchFeature,
      ],
    };
    this.tree = createTree<SpikeNode>(config);
  }

  firstUpdated(): void {
    this.tree.setMounted?.(true);
    this.tree.rebuildTree();
  }

  updated(): void {
    this.renderedRows =
      this.renderRoot.querySelectorAll(".row").length || this.renderedRows;
  }

  // Bridges Headless Tree's React-shaped prop bag onto a real DOM node: the
  // `ref` callback registers the element, `onX` keys become listeners, and the
  // rest are attributes. Listeners are re-bound per render (fresh item
  // instances after a rebuild), so stale ones are torn down first.
  private bindItemProps(
    element: Element | undefined,
    props: Record<string, unknown>,
  ): void {
    if (!element) return;

    const previous = this.boundListeners.get(element);
    if (previous) {
      for (const [type, listener] of previous) {
        element.removeEventListener(type, listener);
      }
    }

    const next: Array<[string, EventListener]> = [];
    for (const [key, value] of Object.entries(props)) {
      if (key === "ref") {
        if (typeof value === "function") {
          (value as (el: Element) => void)(element);
        }
        continue;
      }
      if (key === "key" || value === undefined || value === null) continue;

      if (typeof value === "function" && key.startsWith("on")) {
        const type = key.slice(2).toLowerCase();
        element.addEventListener(type, value as EventListener);
        next.push([type, value as EventListener]);
        continue;
      }
      if (key === "tabIndex") {
        (element as HTMLElement).tabIndex = value as number;
        continue;
      }
      if (key === "draggable") {
        (element as HTMLElement).draggable = Boolean(value);
        continue;
      }
      element.setAttribute(key, String(value));
    }
    this.boundListeners.set(element, next);
  }

  private renderRow = (item: ItemInstance<SpikeNode>): TemplateResult => {
    const level = item.getItemMeta().level;
    const props = item.getProps();
    const chevron = item.isExpanded() ? "▾" : "▸";
    const loading = item.isLoading();
    return html`
      <div
        class="row"
        style="padding-left: calc(${level} * var(--om-tree-indent))"
        ${ref((el) => this.bindItemProps(el, props))}
      >
        ${item.isFolder()
          ? html`<span class="chevron">${chevron}</span>`
          : html`<span class="leaf-dot">•</span>`}
        ${this.renderIcon(item)}
        <span class=${loading ? "loading" : ""}>
          ${loading ? "Loading…" : this.highlight(item.getItemName())}
        </span>
      </div>
    `;
  };

  // Stand-in for the real per-class Modelica icon: a folder-ish "P" for a
  // package, a "B" chip for a leaf block. The production component drops the
  // lazily-fetched class SVG here instead.
  private renderIcon(item: ItemInstance<SpikeNode>): TemplateResult {
    const folder = item.isFolder();
    return html`<span
      class="icon"
      style="background:${folder ? "#c48a12" : "#2f6feb"}"
      >${folder ? "P" : "B"}</span
    >`;
  }

  // Wraps the matched substring in <mark> so search hits read at a glance.
  private highlight(label: string): TemplateResult {
    const q = this.tree.getSearchValue();
    if (!q) return html`${label}`;
    const at = label.toLowerCase().indexOf(q.toLowerCase());
    if (at < 0) return html`${label}`;
    return html`${label.slice(0, at)}<mark>${label.slice(
      at,
      at + q.length,
    )}</mark>${label.slice(at + q.length)}`;
  }

  private onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      if (this.tree.isSearchOpen()) this.tree.setSearch(value);
      else this.tree.openSearch(value);
    } else {
      this.tree.closeSearch();
    }
    this.requestUpdate();
  }

  private onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  private onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    const canvas = this.canvasEl;
    if (!canvas || !event.dataTransfer) return;

    const raw = event.dataTransfer.getData(DRAG_FORMAT);
    if (!raw) return;

    let payload: { id: string; name: string };
    try {
      payload = JSON.parse(raw) as { id: string; name: string };
    } catch {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const drop: CanvasDrop = {
      id: payload.id,
      name: payload.name,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    this.drops.push(drop);
    this.lastDrop = drop;
    this.paintCanvas();
  }

  private paintCanvas(): void {
    const canvas = this.canvasEl;
    if (!canvas) return;
    // Match the backing store to the CSS box so text isn't stretched.
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width) canvas.width = rect.width;
    if (canvas.height !== rect.height) canvas.height = rect.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const drop of this.drops) {
      ctx.fillStyle = "#0a6cff";
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1f1f1f";
      ctx.fillText(drop.name, drop.x + 8, drop.y);
    }
  }

  render(): TemplateResult {
    // Search only matches already-loaded nodes; the production component pairs
    // this with the flat `searchAll` OMC path for whole-library search.
    const searching = this.tree.getSearchValue().length > 0;
    const matches = searching ? this.tree.getSearchMatchingItems() : [];
    const items = searching ? matches : this.tree.getItems();
    const dropLabel = this.lastDrop
      ? `${this.lastDrop.name} @ (${Math.round(this.lastDrop.x)}, ${Math.round(
          this.lastDrop.y,
        )})`
      : "— drag a row onto the canvas →";
    return html`
      <div class="stats">
        <input
          class="search"
          type="search"
          placeholder="Search loaded nodes…"
          @input=${this.onSearch}
        />
        <span>Potential nodes: <strong>${this.totalNodes}</strong></span>
        ${searching
          ? html`<span>Matches: <strong>${matches.length}</strong></span>`
          : html`<span
              >Rows in DOM: <strong>${this.renderedRows}</strong></span
            >`}
        <span>Last drop: <strong>${dropLabel}</strong></span>
      </div>
      <div class="split">
        <lit-virtualizer
          .items=${items}
          .keyFunction=${(item: ItemInstance<SpikeNode>) => item.getId()}
          .renderItem=${this.renderRow}
        ></lit-virtualizer>
        <canvas
          @dragover=${this.onCanvasDragOver}
          @drop=${this.onCanvasDrop}
        ></canvas>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-library-tree-spike": OmLibraryTreeSpike;
  }
}

const meta: Meta = {
  title: "diagram-ui/LibraryTreeSpike",
  parameters: { chromatic: { disableSnapshot: true } },
  render: () => html`<om-library-tree-spike></om-library-tree-spike>`,
};

export default meta;

type Story = StoryObj;

export const Default: Story = {};
