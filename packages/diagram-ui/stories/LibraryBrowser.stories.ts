/**
 * Stories for `<om-library-browser>`.
 *
 * Uses a hardcoded fake `LibraryBrowserDataSource` so the story bundle
 * stays browser-only — the real wiring in the extension calls into OMC
 * via `client.getClassNames(...)`, which can't load in a browser.
 *
 *   - Default: open browser, expand Modelica → Blocks, pick a class.
 *   - WithSearch: type `gain` to see search-mode results.
 *   - Empty: data-source returns `[]` to demonstrate the empty state.
 *   - WithError: data-source rejects to show the inline error.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/library-browser/library-browser.component.js";
import type {
  LibraryBrowserDataSource,
  LibraryClassInfo,
  LibraryClassRestriction,
} from "../src/library-browser/library-browser.component.js";

interface StoryArgs {
  open: boolean;
  source: "fake" | "empty" | "error";
}

// `[qualified, restriction]` pairs per parent path so the fake tree
// also exercises the per-restriction icon rendering. `__ROOT__` is
// the listChildren(null) bucket.
type FakeEntry = readonly [string, LibraryClassRestriction];
const FAKE_TREE: Record<string, readonly FakeEntry[]> = {
  __ROOT__: [
    ["Modelica", "package"],
    ["ModelicaServices", "package"],
    ["Complex", "operator record"],
    ["MyPackage", "package"],
  ],
  Modelica: [
    ["Modelica.Blocks", "package"],
    ["Modelica.Mechanics", "package"],
    ["Modelica.Electrical", "package"],
    ["Modelica.Math", "package"],
  ],
  "Modelica.Blocks": [
    ["Modelica.Blocks.Math", "package"],
    ["Modelica.Blocks.Sources", "package"],
    ["Modelica.Blocks.Continuous", "package"],
    ["Modelica.Blocks.Examples", "package"],
    ["Modelica.Blocks.Interfaces", "package"],
  ],
  "Modelica.Blocks.Math": [
    ["Modelica.Blocks.Math.Gain", "block"],
    ["Modelica.Blocks.Math.Add", "block"],
    ["Modelica.Blocks.Math.Sum", "block"],
    ["Modelica.Blocks.Math.Product", "block"],
  ],
  "Modelica.Blocks.Sources": [
    ["Modelica.Blocks.Sources.Constant", "block"],
    ["Modelica.Blocks.Sources.Step", "block"],
    ["Modelica.Blocks.Sources.Sine", "block"],
  ],
  "Modelica.Blocks.Continuous": [
    ["Modelica.Blocks.Continuous.Integrator", "block"],
    ["Modelica.Blocks.Continuous.Derivative", "block"],
    ["Modelica.Blocks.Continuous.PID", "block"],
  ],
  "Modelica.Blocks.Interfaces": [
    ["Modelica.Blocks.Interfaces.RealInput", "connector"],
    ["Modelica.Blocks.Interfaces.RealOutput", "connector"],
    ["Modelica.Blocks.Interfaces.SISO", "model"],
  ],
  "Modelica.Mechanics": [
    ["Modelica.Mechanics.Rotational", "package"],
    ["Modelica.Mechanics.Translational", "package"],
  ],
  "Modelica.Electrical": [
    ["Modelica.Electrical.Analog", "package"],
    ["Modelica.Electrical.Digital", "package"],
  ],
  "Modelica.Math": [
    ["Modelica.Math.sin", "function"],
    ["Modelica.Math.cos", "function"],
    ["Modelica.Math.Vectors", "package"],
  ],
  MyPackage: [
    ["MyPackage.Resistor", "model"],
    ["MyPackage.Capacitor", "model"],
    ["MyPackage.Voltage", "type"],
    ["MyPackage.Params", "record"],
  ],
};

const ALL_FLAT: LibraryClassInfo[] = (() => {
  const seen = new Set<string>();
  const out: LibraryClassInfo[] = [];
  for (const entries of Object.values(FAKE_TREE)) {
    for (const [qualified, restriction] of entries) {
      if (seen.has(qualified)) continue;
      seen.add(qualified);
      out.push({ qualified, restriction });
    }
  }
  return out;
})();

function entriesOf(parent: string | null): LibraryClassInfo[] {
  const rows = FAKE_TREE[parent ?? "__ROOT__"] ?? [];
  return rows.map(([qualified, restriction]) => ({ qualified, restriction }));
}

const fakeSource: LibraryBrowserDataSource = {
  async listChildren(parent: string | null): Promise<LibraryClassInfo[]> {
    // Simulate OMC latency so the spinner states are visible in the
    // story. Real `getClassNames` typically runs in a few ms.
    await new Promise((r) => setTimeout(r, 120));
    return entriesOf(parent);
  },
  async searchAll(query: string): Promise<LibraryClassInfo[]> {
    await new Promise((r) => setTimeout(r, 120));
    const q = query.toLowerCase();
    return ALL_FLAT.filter((info) => info.qualified.toLowerCase().includes(q));
  },
};

const emptySource: LibraryBrowserDataSource = {
  async listChildren(): Promise<LibraryClassInfo[]> {
    return [];
  },
  async searchAll(): Promise<LibraryClassInfo[]> {
    return [];
  },
};

const errorSource: LibraryBrowserDataSource = {
  async listChildren(): Promise<LibraryClassInfo[]> {
    throw new Error("OMC: connection refused");
  },
  async searchAll(): Promise<LibraryClassInfo[]> {
    throw new Error("OMC: connection refused");
  },
};

function sourceFor(name: StoryArgs["source"]): LibraryBrowserDataSource {
  switch (name) {
    case "empty":
      return emptySource;
    case "error":
      return errorSource;
    default:
      return fakeSource;
  }
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/LibraryBrowser",
  argTypes: {
    source: {
      control: { type: "inline-radio" },
      options: ["fake", "empty", "error"],
    },
  },
  render: ({ open, source }: StoryArgs): TemplateResult => html`
    <div
      style="position: relative; height: 480px; background: repeating-linear-gradient(45deg, #f5f5f5, #f5f5f5 8px, #ececec 8px, #ececec 16px); border-radius: 4px;"
      @om-library-select=${(e: CustomEvent) => {
        console.log("library-select", e.detail);
      }}
      @om-library-cancel=${() => {
        console.log("library-cancel");
      }}
    >
      <om-library-browser
        ?open=${open}
        .dataSource=${sourceFor(source)}
      ></om-library-browser>
    </div>
  `,
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: { open: true, source: "fake" },
};

export const Empty: Story = {
  args: { open: true, source: "empty" },
};

export const WithError: Story = {
  args: { open: true, source: "error" },
};
