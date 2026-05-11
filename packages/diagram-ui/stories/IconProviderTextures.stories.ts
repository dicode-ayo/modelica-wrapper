/**
 * Production icon-provider exercise. Wraps `<om-icon-provider>`
 * (default `renderSvg` + `rasterize`) and lets you see EXACTLY what
 * texture the cache returns for a real Modelica icon fixture.
 *
 * Two stories:
 *
 *   - **MipmapLadder** — same icon rendered on five planes at
 *     descending sizes (100 / 50 / 20 / 8 / 3 diagram units). Zoom
 *     is constant so the on-screen pixel area shrinks geometrically.
 *     If mipmaps are being generated AND sampled, the small planes
 *     stay smooth. If not, you'll see aliasing / sparkles.
 *
 *   - **IconCatalog** — three fixtures side-by-side (Gain / Inertia
 *     / SpringDamper), all at the same size. Tests the cache dedup
 *     (each unique fixture rasterises once) and demonstrates the
 *     icon-provider returning different textures for different
 *     classes.
 *
 * Enable the `debug` toggle on either story to:
 *   - Open Babylon's Inspector (use it to inspect the texture
 *     object: Materials → om-debug-plane → emissiveTexture → click
 *     for the live mipmap-aware preview).
 *   - Turn on rasteriser logging so each cache miss prints
 *     `[diagram-ui] SVG texture ready { size, hasAlpha, ... }`.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type {
  CoordinateSystem,
  IconLayer,
} from "@modelica-wrapper/omc-client";

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

/** Same Gain icon rendered at five sizes so mipmap level selection
 *  is visible — small planes should look smooth, big planes show
 *  the source mip 0 directly. */
export const MipmapLadder: Story = {
  args: { debug: false },
  render: ({ debug }): TemplateResult => html`
    <div class="om-story">
      <h3>Mipmap ladder — same Gain icon at 5 sizes</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Left → right: plane sizes 100, 50, 20, 8, 3 diagram units.
        Same fixture, same icon-provider texture object (one cache
        hit). If mipmaps are working the small planes stay legible;
        if not you'll see jagged shimmering on the right side.
      </p>
      <div class="om-story-canvas-host">
        <om-icon-provider>
          <om-scene zoom="80" ?debug=${debug}>
            <om-grid-axis .extent=${500}></om-grid-axis>
            <om-debug-plane
              .x=${-70}
              .y=${0}
              .size=${100}
              .layers=${GAIN.iconLayers}
              .coordinateSystem=${GAIN.coordinateSystem ?? undefined}
            ></om-debug-plane>
            <om-debug-plane
              .x=${10}
              .y=${0}
              .size=${50}
              .layers=${GAIN.iconLayers}
              .coordinateSystem=${GAIN.coordinateSystem ?? undefined}
            ></om-debug-plane>
            <om-debug-plane
              .x=${50}
              .y=${0}
              .size=${20}
              .layers=${GAIN.iconLayers}
              .coordinateSystem=${GAIN.coordinateSystem ?? undefined}
            ></om-debug-plane>
            <om-debug-plane
              .x=${68}
              .y=${0}
              .size=${8}
              .layers=${GAIN.iconLayers}
              .coordinateSystem=${GAIN.coordinateSystem ?? undefined}
            ></om-debug-plane>
            <om-debug-plane
              .x=${75}
              .y=${0}
              .size=${3}
              .layers=${GAIN.iconLayers}
              .coordinateSystem=${GAIN.coordinateSystem ?? undefined}
            ></om-debug-plane>
          </om-scene>
        </om-icon-provider>
      </div>
    </div>
  `,
};

/** Three different real fixtures at the same size — useful for cache
 *  inspection (three unique cache entries) and for verifying that
 *  the icon-provider isn't conflating different inputs. */
export const IconCatalog: Story = {
  args: { debug: false },
  render: ({ debug }): TemplateResult => html`
    <div class="om-story">
      <h3>Icon catalog — three fixtures, one provider</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Gain / Inertia / SpringDamper rendered through the same
        production icon-provider. Each row is one cache entry. Open
        the Babylon Inspector (debug=true) and click any plane's
        material → emissiveTexture for a live preview of the
        generated PNG and its mipmap chain.
      </p>
      <div class="om-story-canvas-host">
        <om-icon-provider>
          <om-scene zoom="80" ?debug=${debug}>
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
          </om-scene>
        </om-icon-provider>
      </div>
    </div>
  `,
};
