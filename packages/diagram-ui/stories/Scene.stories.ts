/**
 * Visual smoke story for `<om-scene>`. Confirms the Babylon engine
 * mounts, the orthographic camera renders, and the canvas fills the
 * configured story host.
 *
 * Nothing is drawn yet — entity stories (D-stage) layer components,
 * connectors and edges on top. The visible artifact at this stage is
 * the empty background of the scene element.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/scene/scene.component.js";

interface StoryArgs {
  zoom: number;
  panX: number;
  panY: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Scene",
  render: ({ zoom, panX, panY }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-scene&gt; — empty</h3>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom} .panX=${panX} .panY=${panY}></om-scene>
      </div>
    </div>
  `,
  argTypes: {
    zoom: { control: { type: "range", min: 10, max: 500, step: 5 } },
    panX: { control: { type: "range", min: -200, max: 200, step: 1 } },
    panY: { control: { type: "range", min: -200, max: 200, step: 1 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Empty: Story = {
  args: {
    zoom: 100,
    panX: 0,
    panY: 0,
  },
};
