/**
 * Spine smoke story for the Pixi renderer: `<om-scene>` + `<om-grid-axis>`
 * only. Isolated import graph so it renders even while other components
 * are mid-migration. Validates the renderer, container roots, the
 * diagram→screen view transform, and grid drawing.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { CoordinateSystem } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";

const CS: CoordinateSystem = {
  extent: [
    [-100, -100],
    [100, 100],
  ],
  grid: [2, 2],
} as CoordinateSystem;

const meta: Meta = {
  title: "diagram-ui/PixiSpine",
};
export default meta;

export const GridOnly: StoryObj = {
  render: (): TemplateResult => html`
    <div style="width:880px;height:600px;border:1px solid #ccc;">
      <om-scene .zoom=${120}>
        <om-grid-axis .coordinateSystem=${CS} .extent=${500}></om-grid-axis>
      </om-scene>
    </div>
  `,
};
