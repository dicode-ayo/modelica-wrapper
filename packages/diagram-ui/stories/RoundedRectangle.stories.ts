/**
 * Visual story for `<om-rectangle>`'s rounded corners. Renders three
 * rectangles side by side at increasing `radius` so Chromatic pins the
 * corner geometry: sharp (radius 0), a moderate radius, and an
 * over-large radius that clamps to half the shorter side (a stadium /
 * pill shape on the square box).
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { RectangleShape } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/primitives/rectangle.component.js";

interface StoryArgs {
  radius: number;
  zoom: number;
}

function rect(
  cx: number,
  radius: number,
  zOrder: number,
): RectangleShape & { _z: number } {
  return {
    kind: "rectangle",
    extent: [
      [cx - 40, -40],
      [cx + 40, 40],
    ],
    lineColor: [33, 33, 33],
    fillColor: [120, 170, 230],
    fillPattern: "Solid",
    pattern: "Solid",
    radius,
    _z: zOrder,
  };
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/RoundedRectangle",
  render: ({ radius, zoom }: StoryArgs): TemplateResult => {
    const shapes = [rect(-120, 0, 0), rect(0, radius, 1), rect(120, 1000, 2)];
    return html`
      <div class="om-story">
        <h3>&lt;om-rectangle&gt; rounded corners</h3>
        <p style="font-size:11px;color:#666;margin:4px 0;">
          Left: sharp (radius 0). Middle: the slider radius (clamped to half the
          shorter side). Right: an over-large radius that clamps to a fully
          rounded box.
        </p>
        <div class="om-story-canvas-host">
          <om-scene .zoom=${zoom}>
            <om-grid-axis .extent=${300}></om-grid-axis>
            ${shapes.map(
              ({ _z, ...shape }) =>
                html`<om-rectangle
                  .shape=${shape}
                  .zOrder=${_z}
                ></om-rectangle>`,
            )}
          </om-scene>
        </div>
      </div>
    `;
  },
  argTypes: {
    radius: { control: { type: "range", min: 0, max: 60, step: 2 } },
    zoom: { control: { type: "range", min: 50, max: 400, step: 10 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: {
    radius: 20,
    zoom: 200,
  },
};
