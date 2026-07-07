/**
 * Stories for `<om-library-tree>` — the virtualized, data-source-driven
 * replacement for the wa-tree library browser. Uses the shared
 * `fakeLibrarySource` fixture so the bundle stays browser-only; the real
 * wiring in the extension calls into OMC.
 *
 *   - Default: lazy tree over the fake library — expand packages, activate a
 *     class to fire `om-library-select`.
 *   - Empty: a data source that returns no classes.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/library-tree/library-tree.component.js";
import type {
  LibraryBrowserDataSource,
  LibrarySelectDetail,
} from "../src/library-browser/library-browser.component.js";
import { fakeLibrarySource } from "./fixtures/fake-library.js";

const emptySource: LibraryBrowserDataSource = {
  async listChildren() {
    return [];
  },
  async searchAll() {
    return [];
  },
};

interface StoryArgs {
  source: "fake" | "empty";
}

function onSelect(e: Event): void {
  const { className } = (e as CustomEvent<LibrarySelectDetail>).detail;
  const log = document.querySelector("#om-library-tree-log");
  if (log) log.textContent = `Selected: ${className}`;
}

function render(args: StoryArgs): TemplateResult {
  const source = args.source === "empty" ? emptySource : fakeLibrarySource;
  return html`
    <div
      style="display:flex;flex-direction:column;gap:8px;height:420px;width:340px"
    >
      <om-library-tree
        .dataSource=${source}
        @om-library-select=${onSelect}
        style="flex:1;min-height:0;border:1px solid var(--vscode-widget-border,#d0d0d0);border-radius:4px;padding:8px"
      ></om-library-tree>
      <output id="om-library-tree-log" style="font:12px monospace"
        >No selection yet.</output
      >
    </div>
  `;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/LibraryTree",
  argTypes: {
    source: { control: "inline-radio", options: ["fake", "empty"] },
  },
  args: { source: "fake" },
  render,
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Empty: Story = { args: { source: "empty" } };
