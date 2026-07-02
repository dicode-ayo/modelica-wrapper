/**
 * Production icon-provider showcase. Wraps `<om-icon-provider>` (default
 * `renderSvg` + `rasterize`) and shows exactly what texture the cache
 * returns for real Modelica icon fixtures: three classes (Gain / Inertia
 * / SpringDamper) at one size, each a distinct cache entry — proving the
 * provider dedups per fixture and returns a different texture per class.
 *
 * Enable the `debug` toggle to turn on rasteriser logging — each cache
 * miss prints `[diagram-ui] SVG texture ready { size, ... }`.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { CoordinateSystem, IconLayer } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/icon-provider/icon-provider.component.js";
import "../src/debug/debug-plane.component.js";

import gainFixture from "./fixtures/gain.icon.json";
import inertiaFixture from "./fixtures/inertia.icon.json";
import springdamperFixture from "./fixtures/springdamper.icon.json";

interface IconFixture {
  className: string;
  iconLayers: IconLayer[];
  coordinateSystem?: CoordinateSystem | null;
}

const GAIN = gainFixture as IconFixture;
const INERTIA = inertiaFixture as IconFixture;
const SPRINGDAMPER = springdamperFixture as IconFixture;

interface StoryArgs {
  debug: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/IconProviderTextures",
  argTypes: {
    debug: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/** Three different real fixtures at the same size — useful for cache
 *  inspection (three unique cache entries) and for verifying that
 *  the icon-provider isn't conflating different inputs. */
export const IconCatalog: Story = {
  args: { debug: false },
  render: ({ debug }): TemplateResult => html`
    <div class="om-story">
      <h3>Icon catalog — three fixtures, one provider</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Gain / Inertia / SpringDamper rendered through the same production
        icon-provider. Each is one cache entry. Toggle <code>debug</code> to log
        each cache miss to the console.
      </p>
      <div class="om-story-canvas-host">
        <om-scene zoom="80" ?debug=${debug}>
          <om-icon-provider>
            <om-grid-axis .extent=${500}></om-grid-axis>
            <om-debug-plane
              .x=${-50}
              .y=${0}
              .size=${40}
              .layers=${GAIN.iconLayers}
              .coordinateSystem=${GAIN.coordinateSystem ?? undefined}
            ></om-debug-plane>
            <om-debug-plane
              .x=${0}
              .y=${0}
              .size=${40}
              .layers=${INERTIA.iconLayers}
              .coordinateSystem=${INERTIA.coordinateSystem ?? undefined}
            ></om-debug-plane>
            <om-debug-plane
              .x=${50}
              .y=${0}
              .size=${40}
              .layers=${SPRINGDAMPER.iconLayers}
              .coordinateSystem=${SPRINGDAMPER.coordinateSystem ?? undefined}
            ></om-debug-plane>
          </om-icon-provider>
        </om-scene>
      </div>
    </div>
  `,
};
