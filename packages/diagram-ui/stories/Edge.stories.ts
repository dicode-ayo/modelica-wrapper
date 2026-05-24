/**
 * Visual story for `<om-edge>`. Demonstrates an orthogonal connection
 * route and the clocked-dashed variant. Edges live in the diagram-root
 * coord system (under `<om-scene>` directly), at z above components.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { Point } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/connection/edge.component.js";

interface StoryArgs {
  clocked: boolean;
  zoom: number;
}

const SAMPLE_PATH: Point[] = [
  [-60, 0],
  [-20, 0],
  [-20, 30],
  [20, 30],
  [20, -10],
  [60, -10],
];

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Edge",
  render: ({ clocked, zoom }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-edge&gt;${clocked ? " — clocked (dashed)" : ""}</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Orthogonal multi-segment route via Babylon's <code>LinesMesh</code>
        / <code>DashedLinesMesh</code> (1-pixel gl.LINES). Wheel zooms,
        middle-drag pans.
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          <om-edge
            nodeId="demo"
            .path=${SAMPLE_PATH}
            ?clocked=${clocked}
          ></om-edge>
        </om-scene>
      </div>
    </div>
  `,
  argTypes: {
    clocked: { control: { type: "boolean" } },
    zoom: { control: { type: "range", min: 20, max: 300, step: 5 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Solid: Story = {
  args: { clocked: false, zoom: 100 },
};

export const Clocked: Story = {
  args: { clocked: true, zoom: 100 },
};
