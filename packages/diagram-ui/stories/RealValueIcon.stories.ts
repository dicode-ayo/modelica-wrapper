/**
 * `Modelica.Blocks.Interaction.Show.RealValue`'s Icon annotation, drawn
 * by both renderers on one page.
 *
 * The fixture is what OMC emits for the class — an explicit navy
 * `lineColor` at `lineThickness = 5`, a `BorderPattern.Raised` neither
 * renderer draws, and a `visible = false` `%number` label that must not
 * paint. `diagram-svg`'s string output sits next to the `<om-*>` canvas
 * primitives on those same shapes, so a difference on screen is a
 * difference between the renderers rather than between two fixtures.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";

import type {
  CoordinateSystem,
  RectangleShape,
  Shape,
  TextShape,
} from "@dicode/omc-client";
import { renderIconLayersToSvg } from "@dicode/diagram-svg";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import { renderLayers } from "../src/primitives/render-shape.js";

const NAVY: [number, number, number] = [0, 0, 127];
const BEIGE: [number, number, number] = [236, 233, 216];

const COORDS = {
  extent: [
    [-100, -100],
    [100, 100],
  ],
  preserveAspectRatio: false,
} satisfies CoordinateSystem;

const REAL_VALUE: Shape[] = [
  {
    kind: "rectangle",
    extent: [
      [-100, -40],
      [100, 40],
    ],
    lineColor: NAVY,
    fillColor: BEIGE,
    fillPattern: "Solid",
    lineThickness: 5,
    borderPattern: "Raised",
  } satisfies RectangleShape,
  {
    kind: "text",
    extent: [
      [-94, -34],
      [96, 34],
    ],
    textString: "0.0",
    fontSize: 0,
  } satisfies TextShape,
  // `visible = not use_numberPort`, which OMC reduces to `false` for a
  // default instance.
  {
    kind: "text",
    visible: false,
    extent: [
      [-150, -70],
      [150, -50],
    ],
    textString: "%number",
    fontSize: 0,
  } satisfies TextShape,
];

interface StoryArgs {
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/RealValueIcon",
  argTypes: {
    zoom: { control: { type: "range", min: 20, max: 400, step: 5 } },
  },
  args: { zoom: 160 },
};
export default meta;

type Story = StoryObj<StoryArgs>;

/**
 * Both renderers on the same three shapes. They agree when the navy
 * frame reads at the same weight in each: an explicit `lineThickness`
 * is drawn literally by both, scaled by neither.
 */
export const BothRenderers: Story = {
  render: ({ zoom }): TemplateResult => html`
    <div class="om-story">
      <h3>RealValue icon — diagram-svg vs. canvas primitives</h3>
      <p class="om-story-caption">
        <code>lineColor = {0, 0, 127}</code> at <code>lineThickness = 5</code>,
        over a beige face. <code>borderPattern = Raised</code> is carried by the
        annotation and drawn by neither renderer. The <code>%number</code> label
        is <code>visible = false</code> and must not appear in either panel.
      </p>
      <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <h4>diagram-svg</h4>
          ${unsafeSVG(
            renderIconLayersToSvg([{ from: "RealValue", shapes: REAL_VALUE }], {
              coordinateSystem: COORDS,
              size: 360,
              background: "white",
              expandViewBoxToShapes: true,
            }),
          )}
        </div>
        <div style="flex:1;min-width:360px;">
          <h4>&lt;om-*&gt; canvas primitives</h4>
          <div class="om-story-canvas-host" style="height:260px;">
            <om-scene .zoom=${zoom}>
              <om-grid-axis .extent=${500}></om-grid-axis>
              ${renderLayers([{ from: "RealValue", shapes: REAL_VALUE }], 0)}
            </om-scene>
          </div>
        </div>
      </div>
    </div>
  `,
};
