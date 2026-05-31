/**
 * Visual story for `<om-connection>` — multi-segment routed line plus
 * optional junction dots at every internal corner.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { Point } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/connection/connection.component.js";

interface StoryArgs {
  showJunctions: boolean;
  clocked: boolean;
  zoom: number;
}

const PATH: Point[] = [
  [-50, -20],
  [-20, -20],
  [-20, 30],
  [20, 30],
  [20, -10],
  [50, -10],
];

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Connection",
  render: ({ showJunctions, clocked, zoom }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-connection&gt;</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Composes one <code>&lt;om-edge&gt;</code> + optional junction markers at
        internal corners. Toggle showJunctions to compare.
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          <om-connection
            nodeId="demo"
            .path=${PATH}
            ?clocked=${clocked}
            ?show-junctions=${showJunctions}
          ></om-connection>
        </om-scene>
      </div>
    </div>
  `,
  argTypes: {
    showJunctions: { control: { type: "boolean" } },
    clocked: { control: { type: "boolean" } },
    zoom: { control: { type: "range", min: 20, max: 300, step: 5 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const WithJunctions: Story = {
  args: { showJunctions: true, clocked: false, zoom: 100 },
};

export const ClockedNoJunctions: Story = {
  args: { showJunctions: false, clocked: true, zoom: 100 },
};
