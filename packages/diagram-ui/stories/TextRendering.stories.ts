/**
 * Text-backend comparison: the same `TextShape`s drawn through each Pixi
 * text class, at a zoom the control drives.
 *
 * `<om-text>` instantiates its Pixi object in `buildMeshes`, so a mode
 * switch only reaches text built afterwards — `keyed` on the mode discards
 * the scene and rebuilds it. Zoom is *not* part of the key: it drives
 * `<om-scene zoom>` on the live scene, which is the path that exercises the
 * `resolution` ramp on zoom-in.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { IconLayer, TextShape } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/graphical-layout/graphical-layout.component.js";
import { renderLayers } from "../src/primitives/render-shape.js";
import { setTextMode, type TextMode } from "../src/primitives/text-mode.js";
import { pidLayout } from "./fixtures/pid-layout.js";

const BLACK: [number, number, number] = [0, 0, 0];

const MODES: readonly TextMode[] = ["canvas", "bitmap", "html"];

/**
 * A ladder of font sizes down to 4 units. The small end is where the
 * backends diverge most: an atlas baked for a 10-unit glyph has nothing
 * left to resample by the time it is drawn at 200% zoom.
 */
const SIZES: readonly number[] = [40, 24, 14, 8, 4];

function textAt(y: number, fontSize: number, body: string): TextShape {
  return {
    kind: "text",
    extent: [
      [-95, y - fontSize / 2],
      [95, y + fontSize / 2],
    ],
    textString: body,
    fontSize,
    textColor: BLACK,
    horizontalAlignment: "Center",
  };
}

const LAYERS: IconLayer[] = [
  {
    from: "Story.TextRendering",
    shapes: SIZES.map((size, i) =>
      textAt(80 - i * 38, size, `${size}u LimPID gjq 0123`),
    ),
  },
];

interface StoryArgs {
  textMode: TextMode;
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/TextRendering",
  render: ({ textMode, zoom }: StoryArgs): TemplateResult => {
    setTextMode(textMode);
    return html`
      <div class="om-story">
        <h3>&lt;om-text&gt; — text backend vs. zoom</h3>
        <p class="om-story-caption">
          <strong>text-mode</strong> picks the Pixi class:
          <code>canvas</code> (<code>Text</code>, one texture per string,
          resolution raised on zoom-in),
          <code>bitmap</code> (<code>BitmapText</code>, shared glyph atlas baked
          at one density — it opts out of the resolution ramp),
          <code>html</code>
          (<code>HTMLText</code>, browser layout via an SVG foreignObject).
        </p>
        <p class="om-story-caption">
          Drag <strong>zoom</strong> down to magnify (it is the diagram
          half-height, so smaller = closer). Watch the 8u and 4u rows: that is
          where a baked atlas gives itself away.
        </p>
        ${keyed(
          textMode,
          html`
            <div class="om-story-canvas-host" style="height: 560px;">
              <om-scene .zoom=${zoom}>
                <om-grid-axis .extent=${500}></om-grid-axis>
                ${renderLayers(LAYERS)}
              </om-scene>
            </div>
          `,
        )}
      </div>
    `;
  },
  argTypes: {
    textMode: {
      control: { type: "inline-radio" },
      options: MODES,
      name: "text-mode",
    },
    zoom: {
      control: { type: "range", min: 5, max: 120, step: 1 },
    },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Backend: Story = {
  args: { textMode: "bitmap", zoom: 100 },
  parameters: { chromatic: { disableSnapshot: true } },
};

/**
 * The same switch over real Modelica text: every component name, parameter
 * value and annotation caption in `PID_Controller` is an `<om-text>`.
 * `<om-graphical-layout>` auto-fits on mount and owns zoom from there, so
 * the `zoom` control does not apply and is hidden.
 */
export const PID: Story = {
  args: { textMode: "bitmap", zoom: 100 },
  argTypes: { zoom: { table: { disable: true }, control: false } },
  parameters: { chromatic: { disableSnapshot: true } },
  render: ({ textMode }: StoryArgs): TemplateResult => {
    setTextMode(textMode);
    return html`
      <div class="om-story">
        <h3>
          &lt;om-text&gt; — text backend on
          Modelica.Blocks.Examples.PID_Controller
        </h3>
        <p class="om-story-caption">
          Switch <strong>text-mode</strong>, then scroll / pinch to zoom into
          <code>k=1</code>, <code>J=1 kg.m2</code> or <code>Ti=0.1 s</code> —
          the small parameter captions are where the backends separate.
          Two-finger scroll pans, pinch zooms.
        </p>
        ${keyed(
          textMode,
          html`
            <div class="om-story-canvas-host" style="height: 620px;">
              <om-graphical-layout
                .layout=${pidLayout}
                readonly
                perf-hud
              ></om-graphical-layout>
            </div>
          `,
        )}
      </div>
    `;
  },
};
