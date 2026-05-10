/**
 * Storybook visual-inspection stories for `renderIconLayersToSvg`.
 *
 * Each story constructs a tiny synthetic `IconLayer[]` and renders it,
 * then wraps the SVG string in a labelled card so the human can eyeball
 * the primitive mapping. Stories are CSF3 functions returning HTML
 * strings — no framework runtime needed.
 *
 * Add new shape-coverage stories here whenever the renderer learns a
 * new primitive (currently rectangle / ellipse / polygon / line / text /
 * bitmap).
 */

import type { Meta, StoryObj } from "@storybook/html";

import {
  renderIconLayersToSvg,
  type IconLayer,
  type RenderOptions,
} from "../src/index.js";

interface StoryArgs {
  layers: IconLayer[];
  opts?: RenderOptions;
  title: string;
  description?: string;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-svg/Icons",
  render: ({ layers, opts, title, description }) => {
    const svg = renderIconLayersToSvg(layers, opts ?? {});
    const card = document.createElement("div");
    card.className = "diagram-svg-story";
    card.style.width = "240px";
    card.innerHTML = `
      <h3>${title}</h3>
      ${description ? `<p style="font-family:sans-serif;font-size:11px;color:#666;margin:4px 0;">${description}</p>` : ""}
      ${svg}
    `;
    return card;
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

// 1×1 transparent PNG, base64-encoded. Renders as a faint dot in the bitmap story.
const PNG_DOT =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZmTHc8AAAAASUVORK5CYII=";

export const RectangleOnly: Story = {
  args: {
    title: "Rectangle",
    layers: [
      {
        from: "Demo.Rect",
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-60, -40],
              [60, 40],
            ],
            fillColor: [180, 220, 255],
            lineColor: [40, 80, 160],
            lineThickness: 1,
            radius: 8,
          },
        ],
      },
    ],
    opts: { background: "white", size: 200 },
  },
};

export const EllipseOnly: Story = {
  args: {
    title: "Ellipse",
    layers: [
      {
        from: "Demo.Ell",
        shapes: [
          {
            kind: "ellipse",
            extent: [
              [-50, -25],
              [50, 25],
            ],
            fillColor: [255, 200, 100],
            lineColor: [180, 80, 0],
            lineThickness: 0.5,
          },
        ],
      },
    ],
    opts: { background: "white", size: 200 },
  },
};

export const PolygonOnly: Story = {
  args: {
    title: "Polygon (triangle apex up)",
    description: "Apex at (0,50) renders at the TOP of the SVG (y-flip works).",
    layers: [
      {
        from: "Demo.Tri",
        shapes: [
          {
            kind: "polygon",
            points: [
              [-50, -30],
              [50, -30],
              [0, 50],
            ],
            fillColor: [120, 220, 120],
            lineColor: [40, 100, 40],
          },
        ],
      },
    ],
    opts: { background: "white", size: 200 },
  },
};

export const LineOnly: Story = {
  args: {
    title: "Line (dashed)",
    layers: [
      {
        from: "Demo.Wire",
        shapes: [
          {
            kind: "line",
            points: [
              [-80, -40],
              [80, 40],
            ],
            color: [200, 50, 50],
            thickness: 2,
            pattern: "Dash",
          },
        ],
      },
    ],
    opts: { background: "white", size: 200 },
  },
};

export const TextOnly: Story = {
  args: {
    title: "Text",
    layers: [
      {
        from: "Demo.Lbl",
        shapes: [
          {
            kind: "text",
            extent: [
              [-80, -15],
              [80, 15],
            ],
            textString: "k = 1.0",
            fontSize: 18,
            textColor: [40, 40, 40],
          },
        ],
      },
    ],
    opts: { background: "white", size: 200 },
  },
};

export const BitmapOnly: Story = {
  args: {
    title: "Bitmap (1px dot scaled up)",
    layers: [
      {
        from: "Demo.Pic",
        shapes: [
          {
            kind: "bitmap",
            extent: [
              [-40, -40],
              [40, 40],
            ],
            imageSource: PNG_DOT,
          },
        ],
      },
    ],
    opts: { background: "white", size: 200 },
  },
};

export const MultiLayerComposite: Story = {
  args: {
    title: "Composite: frame ancestor + leaf overlay",
    description: "Layer order: ancestor first (background frame), host last (foreground polygon + label). Mimics Synth.Host fixture.",
    layers: [
      {
        from: "Synth.Frame",
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-100, -100],
              [100, 100],
            ],
            fillColor: [240, 240, 240],
            lineColor: [120, 120, 120],
            lineThickness: 0.5,
          },
        ],
      },
      {
        from: "Synth.Host",
        shapes: [
          {
            kind: "polygon",
            points: [
              [-50, -30],
              [50, -30],
              [0, 50],
            ],
            fillColor: [80, 160, 240],
            lineColor: [10, 60, 120],
            lineThickness: 1,
          },
          {
            kind: "text",
            extent: [
              [-90, -90],
              [90, -55],
            ],
            textString: "Synth.Host",
            fontSize: 16,
            textColor: [20, 20, 20],
          },
        ],
      },
    ],
    opts: { background: "white", size: 240 },
  },
};

export const WithinViewbox: Story = {
  args: {
    title: "Custom viewBox [-200..200]",
    description: "Same shape rendered at twice the default coordinate range — the icon shrinks accordingly.",
    layers: [
      {
        from: "Demo.Big",
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-50, -50],
              [50, 50],
            ],
            fillColor: [255, 220, 220],
            lineColor: [200, 60, 60],
            lineThickness: 1,
          },
        ],
        coordinateSystem: {
          extent: [
            [-200, -200],
            [200, 200],
          ],
        },
      },
    ],
    opts: { background: "white", size: 240 },
  },
};

export const BackgroundAndSize: Story = {
  args: {
    title: "background + size options",
    description: "Explicit pixel size and a non-white background to demonstrate RenderOptions.",
    layers: [
      {
        from: "Demo.Bg",
        shapes: [
          {
            kind: "ellipse",
            extent: [
              [-40, -40],
              [40, 40],
            ],
            fillColor: [255, 255, 255],
            lineColor: [0, 0, 0],
            lineThickness: 1,
          },
        ],
      },
    ],
    opts: {
      background: "#222",
      size: { width: 160, height: 100 },
    },
  },
};
