/**
 * Visual story for `<om-label>`. Demonstrates an HTML/GUI text label
 * linked to a Babylon TransformNode in diagram-coord space.
 *
 * Font size is in screen pixels — pan/zoom the scene and watch the
 * label stay legible at any zoom.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/label/label.component.js";

interface StoryArgs {
  text: string;
  x: number;
  y: number;
  rotation: number;
  fontSize: number;
  color: string;
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Label",
  render: ({
    text,
    x,
    y,
    rotation,
    fontSize,
    color,
    zoom,
  }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-label&gt;</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Linked to a TransformNode at (${x}, ${y}). Font is rendered via
        Babylon.GUI's AdvancedDynamicTexture so it stays sharp at any zoom.
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          <om-label
            nodeId="demo"
            .text=${text}
            .x=${x}
            .y=${y}
            .rotation=${rotation}
            .fontSize=${fontSize}
            .color=${color}
          ></om-label>
        </om-scene>
      </div>
    </div>
  `,
  argTypes: {
    text: { control: { type: "text" } },
    x: { control: { type: "range", min: -50, max: 50, step: 1 } },
    y: { control: { type: "range", min: -50, max: 50, step: 1 } },
    rotation: { control: { type: "range", min: -180, max: 180, step: 5 } },
    fontSize: { control: { type: "range", min: 8, max: 48, step: 1 } },
    color: { control: { type: "color" } },
    zoom: { control: { type: "range", min: 20, max: 200, step: 5 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: {
    text: "Hello Modelica",
    x: 0,
    y: 0,
    rotation: 0,
    fontSize: 14,
    color: "#222",
    zoom: 60,
  },
};
