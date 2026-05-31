/**
 * Visual story for `<om-grid-axis>`. Adds the grid + axis layer on top
 * of the empty scene from `Scene.stories.ts` so the user can verify
 * minor/major spacing and the prominent X / Y axes.
 *
 * Wheel and middle-mouse drag from the PanZoom helper let you exercise
 * the grid across zoom levels.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";

interface StoryArgs {
  extent: number;
  minorStep: number;
  majorStep: number;
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/GridAxis",
  render: ({
    extent,
    minorStep,
    majorStep,
    zoom,
  }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-grid-axis&gt;</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Minor / major grid + bold X and Y axes. Wheel to zoom, middle-drag to
        pan.
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis
            .extent=${extent}
            .minorStep=${minorStep}
            .majorStep=${majorStep}
          ></om-grid-axis>
        </om-scene>
      </div>
    </div>
  `,
  argTypes: {
    extent: { control: { type: "range", min: 100, max: 2000, step: 50 } },
    minorStep: { control: { type: "range", min: 1, max: 50, step: 1 } },
    majorStep: { control: { type: "range", min: 10, max: 500, step: 5 } },
    zoom: { control: { type: "range", min: 10, max: 500, step: 5 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: {
    extent: 500,
    minorStep: 10,
    majorStep: 100,
    zoom: 120,
  },
};
