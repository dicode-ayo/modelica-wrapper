/**
 * The diagram as the extension wires it: `<om-graphical-layout>` with the
 * `<om-action-panel>` toolbar overlaid, hooked together exactly like
 * `webview-entry.ts`. Pick a shape from the toolbar and drag to draw, R/F to
 * rotate/flip the selection, etc. — the one story to exercise the whole surface.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import "../src/action-panel/action-panel.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmActionPanel } from "../src/action-panel/action-panel.component.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";
import type {
  ActionFlipDetail,
  ActionRotateDetail,
  ActionToolDetail,
} from "../src/action-panel/action-panel.component.js";
import { sampleLayout } from "./fixtures/sample-layout.js";
import { appendConnection } from "./fixtures/story-layout-state.js";

interface StoryArgs {
  readonly: boolean;
}

let currentLayout: DiagramLayout = sampleLayout();

const diagram = (): OmGraphicalLayout | null =>
  document.querySelector("om-graphical-layout");
const panel = (): OmActionPanel | null =>
  document.querySelector("om-action-panel");

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/DiagramWorkbench",
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Diagram workbench</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Toolbar + canvas, wired as in the extension. Pick Rectangle / Ellipse
        from the draw dropdown (top-right) and drag on the canvas to draw;
        Escape disarms. Click to select, drag to move, R/F to rotate/flip.
      </p>
      <div
        class="om-story-canvas-host"
        style="position: relative; height: 540px;"
      >
        <om-graphical-layout
          .layout=${currentLayout}
          ?readonly=${readonly}
          @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
            currentLayout = e.detail;
          }}
          @om-selection-change=${(
            e: CustomEvent<LayoutEvents["om-selection-change"]>,
          ) => {
            const p = panel();
            if (p) p.noSelection = e.detail.keys.length === 0;
          }}
          @om-tool-change=${(
            e: CustomEvent<LayoutEvents["om-tool-change"]>,
          ) => {
            const p = panel();
            if (p) p.tool = e.detail.tool;
          }}
          @om-connection-create=${(
            e: CustomEvent<LayoutEvents["om-connection-create"]>,
          ) => {
            currentLayout = appendConnection(currentLayout, e.detail);
            const el = diagram();
            if (el) el.layout = currentLayout;
          }}
        ></om-graphical-layout>
        <om-action-panel
          anchor="top-right"
          ?no-selection=${true}
          @om-action-undo=${() => console.log("undo")}
          @om-action-check=${() => console.log("check")}
          @om-action-simulate=${() => console.log("simulate")}
          @om-action-parameters=${() => console.log("parameters")}
          @om-action-rotate=${(e: CustomEvent<ActionRotateDetail>) =>
            diagram()?.rotateSelection(e.detail.direction === "cw")}
          @om-action-flip=${(e: CustomEvent<ActionFlipDetail>) =>
            diagram()?.flipSelection(e.detail.axis === "horizontal")}
          @om-action-tool=${(e: CustomEvent<ActionToolDetail>) =>
            diagram()?.setActiveTool(e.detail.tool)}
        ></om-action-panel>
      </div>
    </div>
  `,
  argTypes: {
    readonly: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: { readonly: false },
};

export const Readonly: Story = {
  args: { readonly: true },
};
