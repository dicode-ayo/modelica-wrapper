/**
 * Visual story for `<om-component>`. Wires the full B+C+D1 pipeline:
 *
 *   <om-icon-provider>
 *     <om-scene>
 *       <om-grid-axis></om-grid-axis>
 *       <om-component .layers=${...} .placement=${...}></om-component>
 *     </om-scene>
 *   </om-icon-provider>
 *
 * Uses real Modelica icons captured against OMC (`*.icon.json`) so the
 * SVG renderer, the icon-provider canvas rasteriser and the Babylon
 * plane mesh all get exercised end-to-end.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/icon-provider/icon-provider.component.js";
import "../src/component/component.component.js";

import gainFixture from "./fixtures/gain.icon.json";
import springdamperFixture from "./fixtures/springdamper.icon.json";
import inertiaFixture from "./fixtures/inertia.icon.json";

interface IconFixture {
  className: string;
  iconLayers: IconLayer[];
  coordinateSystem?: CoordinateSystem | null;
}

const FIXTURES: Record<string, IconFixture> = {
  gain: gainFixture as IconFixture,
  springdamper: springdamperFixture as IconFixture,
  inertia: inertiaFixture as IconFixture,
};

interface StoryArgs {
  fixture: "gain" | "springdamper" | "inertia";
  extentHalf: number;
  rotation: number;
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Component",
  render: ({ fixture, extentHalf, rotation, zoom }: StoryArgs): TemplateResult => {
    const f = FIXTURES[fixture]!;
    const placement: Placement = {
      extent: [
        [-extentHalf, -extentHalf],
        [extentHalf, extentHalf],
      ],
      rotation,
    };
    return html`
      <div class="om-story">
        <h3>&lt;om-component&gt; — ${fixture}</h3>
        <p style="font-size:11px;color:#666;margin:4px 0;">
          End-to-end: getModelInstance fixture → renderIconLayersToSvg
          → canvas rasteriser → Babylon Texture → plane mesh.
        </p>
        <div class="om-story-canvas-host">
          <om-scene .zoom=${zoom}>
            <om-icon-provider>
              <om-grid-axis .extent=${500}></om-grid-axis>
              <om-component
                nodeId="demo"
                .placement=${placement}
                .layers=${f.iconLayers}
                .coordinateSystem=${f.coordinateSystem ?? undefined}
              ></om-component>
            </om-icon-provider>
          </om-scene>
        </div>
      </div>
    `;
  },
  argTypes: {
    fixture: {
      control: { type: "select" },
      options: ["gain", "springdamper", "inertia"],
    },
    extentHalf: { control: { type: "range", min: 5, max: 100, step: 5 } },
    rotation: { control: { type: "range", min: -180, max: 180, step: 5 } },
    zoom: { control: { type: "range", min: 20, max: 300, step: 5 } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Gain: Story = {
  args: {
    fixture: "gain",
    extentHalf: 30,
    rotation: 0,
    zoom: 100,
  },
};

export const SpringDamper: Story = {
  args: {
    fixture: "springdamper",
    extentHalf: 30,
    rotation: 0,
    zoom: 100,
  },
};
