/**
 * Stories for `<om-library-tree>` — the virtualized, data-source-driven
 * replacement for the wa-tree library browser. Uses the shared
 * `fakeLibrarySource` fixture so the bundle stays browser-only; the real
 * wiring in the extension calls into OMC.
 *
 *   - Default: lazy tree over the fake library — expand packages, activate a
 *     class to fire `om-library-select`.
 *   - Empty: a data source that returns no classes.
 *   - PlacementDrag: rows arm `om-library-placement-start` on pointer-down
 *     instead of an HTML5 drag, as the sidebar webview needs.
 *   - WithIcons: a data source that resolves `iconSvg`, logging every call to
 *     `#om-library-tree-icon-calls` — the real-browser harness for the lazy,
 *     per-visible-row icon fetch (`packages/diagram-ui/e2e/library-tree.spec.ts`).
 *     happy-dom can't render `<lit-virtualizer>`, so this behavior isn't
 *     observable through the vitest suite.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/library-tree/library-tree.component.js";
import type {
  LibraryDataSource,
  LibrarySelectDetail,
} from "../src/library-tree/library-types.js";
import type { LibraryPlacementStartDetail } from "../src/library-tree/library-tree.component.js";
import { fakeLibrarySource } from "./fixtures/fake-library.js";

/** `iconSvg` over the fake library, logging each call (in order) as a JSON
 *  array to `#om-library-tree-icon-calls` and resolving a version-stamped SVG
 *  so a re-fetch (`invalidateIcon`) is visible in the rendered markup. */
function iconLoggingSource(): LibraryDataSource {
  const calls: string[] = [];
  return {
    listChildren: fakeLibrarySource.listChildren,
    searchAll: fakeLibrarySource.searchAll,
    async iconSvg(className) {
      calls.push(className);
      const log = document.querySelector("#om-library-tree-icon-calls");
      if (log) log.textContent = JSON.stringify(calls);
      const version = calls.filter((c) => c === className).length;
      await new Promise((r) => setTimeout(r, 20));
      return `<svg xmlns="http://www.w3.org/2000/svg"><title>${className} v${version}</title></svg>`;
    },
  };
}

function renderWithIcons(): TemplateResult {
  return html`
    <div
      style="display:flex;flex-direction:column;gap:8px;height:420px;width:340px"
    >
      <om-library-tree
        .dataSource=${iconLoggingSource()}
        style="flex:1;min-height:0;border:1px solid var(--vscode-widget-border,#d0d0d0);border-radius:4px;padding:8px"
      ></om-library-tree>
      <output id="om-library-tree-icon-calls">[]</output>
    </div>
  `;
}

const emptySource: LibraryDataSource = {
  async listChildren() {
    return [];
  },
  async searchAll() {
    return [];
  },
};

interface StoryArgs {
  source: "fake" | "empty";
  placementDrag: boolean;
}

function onSelect(e: Event): void {
  const { className } = (e as CustomEvent<LibrarySelectDetail>).detail;
  const log = document.querySelector("#om-library-tree-log");
  if (log) log.textContent = `Selected: ${className}`;
}

function onPlacementStart(e: Event): void {
  const { className } = (e as CustomEvent<LibraryPlacementStartDetail>).detail;
  const log = document.querySelector("#om-library-tree-placement");
  if (log) log.textContent = `Placing: ${className}`;
}

function render(args: StoryArgs): TemplateResult {
  const source = args.source === "empty" ? emptySource : fakeLibrarySource;
  return html`
    <div
      style="display:flex;flex-direction:column;gap:8px;height:420px;width:340px"
    >
      <om-library-tree
        .dataSource=${source}
        ?placement-drag=${args.placementDrag}
        @om-library-select=${onSelect}
        @om-library-placement-start=${onPlacementStart}
        style="flex:1;min-height:0;border:1px solid var(--vscode-widget-border,#d0d0d0);border-radius:4px;padding:8px"
      ></om-library-tree>
      <output id="om-library-tree-log" style="font:12px monospace"
        >No selection yet.</output
      >
      <output id="om-library-tree-placement" style="font:12px monospace"
        >No placement yet.</output
      >
    </div>
  `;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/LibraryTree",
  argTypes: {
    source: { control: "inline-radio", options: ["fake", "empty"] },
    placementDrag: { control: "boolean" },
  },
  args: { source: "fake", placementDrag: false },
  render,
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Empty: Story = { args: { source: "empty" } };

export const PlacementDrag: Story = { args: { placementDrag: true } };

export const WithIcons: Story = { render: renderWithIcons };
