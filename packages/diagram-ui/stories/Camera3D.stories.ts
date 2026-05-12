/**
 * Story demonstrating the camera-mode toggle. Wheels and middle-drag
 * (2D mode) versus Babylon's built-in ArcRotateCamera inputs (3D mode).
 *
 * The MultiBody root is empty in this commit — only the seam exists,
 * so the user sees the diagram plane from either angle, with the
 * MultiBody root TransformNode placed alongside (visible in the
 * Babylon inspector when enabled).
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/multibody/multibody-root.component.js";

interface StoryArgs {
  mode: "2d" | "3d";
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Camera3D",
  render: ({ mode, zoom }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Camera mode: ${mode}</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Toggle <code>camera-mode</code> to switch between 2D
        orthographic editing and free 3D orbit. The MultiBody root
        TransformNode is the seam for future visualisers (boxes,
        cylinders, mesh files).
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom} camera-mode=${mode}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          <om-multibody-root></om-multibody-root>
        </om-scene>
      </div>
    </div>
  `,
  argTypes: {
    mode: { control: { type: "inline-radio" }, options: ["2d", "3d"] },
    zoom: { control: { type: "range", min: 20, max: 300, step: 5 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const TopDown2D: Story = { args: { mode: "2d", zoom: 100 } };
export const FreeOrbit3D: Story = { args: { mode: "3d", zoom: 100 } };
