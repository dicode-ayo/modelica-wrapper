/**
 * Visual story for the six icon primitives that compose every Modelica
 * shape annotation — `<om-rectangle>`, `<om-polygon>`, `<om-line>`,
 * `<om-ellipse>`, `<om-text>`, `<om-bitmap>`. Two angles:
 *
 *   "Direct"   — each primitive parented straight to `<om-scene>`'s
 *                 diagramRoot via the parent-node context. Isolates
 *                 the primitive's own build / dispose path.
 *
 *   "HostViaLayout" — a minimal `DiagramLayout` whose `diagramLayers`
 *                 carry the same six shapes, fed through
 *                 `<om-graphical-layout>`. Mirrors the real-app path
 *                 (`renderHostShapes` → `renderLayers` → `<om-*>`)
 *                 so we can spot any wiring difference that hides
 *                 the host's diagram-level annotations when running
 *                 inside the extension webview.
 *
 * If the "Direct" variant paints but "HostViaLayout" doesn't, the bug
 * is in the graphical-layout glue or the context propagation across
 * <om-scene>'s slot. If neither paints, the bug is in the primitive
 * itself.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type {
  BitmapShape,
  DiagramLayout,
  EllipseShape,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
} from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/graphical-layout/graphical-layout.component.js";
import { renderLayers } from "../src/primitives/render-shape.js";
import { DEFAULT_LINE_COLOR } from "../src/primitives/shape-utils.js";

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [60, 120, 220];

// Six representative shapes, sized to the [-100, 100] coord system so
// the camera's default zoom fits them all on one canvas.
const SHAPES: Shape[] = [
  {
    kind: "rectangle",
    extent: [
      [-90, 20],
      [-30, 70],
    ],
    lineColor: RED,
    fillColor: BLUE,
    pattern: "Solid",
    fillPattern: "Solid",
  } as RectangleShape,
  {
    kind: "polygon",
    points: [
      [-90, -70],
      [-30, -70],
      [-60, -20],
    ],
    lineColor: RED,
    fillColor: BLUE,
    pattern: "Solid",
    fillPattern: "Solid",
  } as PolygonShape,
  {
    kind: "line",
    points: [
      [-10, 70],
      [60, 30],
      [60, -20],
      [-10, -60],
    ],
    color: RED,
    pattern: "Solid",
  } as LineShape,
  {
    kind: "ellipse",
    extent: [
      [10, 20],
      [80, 70],
    ],
    lineColor: RED,
    fillColor: BLUE,
    pattern: "Solid",
    fillPattern: "Solid",
  } as EllipseShape,
  {
    kind: "text",
    extent: [
      [10, -50],
      [90, -30],
    ],
    textString: "<om-text>" as unknown as TextShape["textString"],
    textColor: RED,
    fontSize: 0,
  } as TextShape,
  // Bitmap deliberately omitted from the visible fixture — needs a real
  // image source and would clutter the story. Uncomment to test:
  // {
  //   kind: "bitmap",
  //   extent: [[-80, -90], [-30, -75]],
  //   imageSource: "data:image/png;base64,iVBORw0KGg…",
  // } as BitmapShape,
];

// Make `BitmapShape` referenced so unused-import warnings don't fire
// when the fixture is left commented above.
void (null as unknown as BitmapShape | undefined);

// Four lines demonstrating each Arrow value at both ends, spread across the
// canvas so the Chromatic baseline captures all three filled variants and the
// open/half chevrons at a glance.
const ARROW_SHAPES: LineShape[] = [
  {
    kind: "line",
    points: [
      [-80, 60],
      [80, 60],
    ],
    color: DEFAULT_LINE_COLOR,
    arrow: ["Filled", "Filled"],
    arrowSize: 6,
  },
  {
    kind: "line",
    points: [
      [-80, 20],
      [80, 20],
    ],
    color: DEFAULT_LINE_COLOR,
    arrow: ["Open", "Open"],
    arrowSize: 6,
  },
  {
    kind: "line",
    points: [
      [-80, -20],
      [80, -20],
    ],
    color: DEFAULT_LINE_COLOR,
    arrow: ["Half", "Half"],
    arrowSize: 6,
  },
  {
    kind: "line",
    points: [
      [-80, -60],
      [80, -60],
    ],
    color: RED,
    arrow: ["None", "Filled"],
    arrowSize: 6,
  },
];

interface StoryArgs {
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Shapes",
  argTypes: {
    zoom: { control: { type: "range", min: 20, max: 200, step: 5 } },
  },
  args: { zoom: 110 },
};
export default meta;

type Story = StoryObj<StoryArgs>;

/**
 * Each primitive parented directly to `<om-scene>`. Pure smoke test of
 * the primitive's `buildMeshes` against the real WebGL engine.
 */
export const Direct: Story = {
  render: ({ zoom }): TemplateResult => html`
    <div class="om-story">
      <h3>Shapes — direct primitives under &lt;om-scene&gt;</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        One element per shape kind, no &lt;om-graphical-layout&gt; in the path.
        Validates that the primitive's mesh build works in isolation.
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          ${renderLayers([{ from: "demo", shapes: SHAPES }], 0)}
        </om-scene>
      </div>
    </div>
  `,
};

/**
 * Same six shapes, but routed through `<om-graphical-layout>` as the
 * host class's `diagramLayers`. Mirrors what happens for a real
 * `Modelica.Blocks.Examples.PID_Controller`. If this is blank but
 * `Direct` paints, the bug is in graphical-layout's plumbing.
 */
export const HostViaLayout: Story = {
  render: (): TemplateResult => {
    const layout: DiagramLayout = {
      kind: "diagram",
      className: "Demo.Host",
      source: { file: "demo.mo", line: 1, column: 1 } as never,
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      iconLayers: [],
      diagramLayers: [{ from: "Demo.Host", shapes: SHAPES }],
      labels: [],
      classes: {},
      components: {},
      connectors: {},
      connections: [],
    };
    return html`
      <div class="om-story">
        <h3>
          Shapes — host class's diagramLayers via &lt;om-graphical-layout&gt;
        </h3>
        <p style="font-size:11px;color:#666;margin:4px 0;">
          Minimal layout with no components / connectors — only host shapes.
          Same code path the extension uses for PID_Controller's red
          annotations. Set <code>zoom</code> if the shapes fall outside view.
        </p>
        <div class="om-story-canvas-host">
          <om-graphical-layout
            .layout=${layout}
            style="display:block;width:100%;height:100%"
          ></om-graphical-layout>
        </div>
      </div>
    `;
  },
};

/**
 * Four horizontal lines covering every Modelica `Arrow` value: Filled / Open
 * / Half / None→Filled. This is the Chromatic baseline for arrowhead
 * rendering on `<om-line>`. If the story is blank, arrowheads are not
 * building or the colour is wrong. Each arrowhead uses `arrowSize=6` so it
 * reads at normal story zoom.
 */
export const ArrowLines: Story = {
  render: ({ zoom }): TemplateResult => html`
    <div class="om-story">
      <h3>Shapes — arrowheads on &lt;om-line&gt;</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Top to bottom: Filled↔Filled, Open↔Open, Half↔Half, None→Filled. All
        arrowSize=6 diagram units.
      </p>
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          ${renderLayers([{ from: "demo-arrows", shapes: ARROW_SHAPES }], 0)}
        </om-scene>
      </div>
    </div>
  `,
};
