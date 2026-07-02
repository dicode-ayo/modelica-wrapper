/**
 * Visual coverage for Modelica `FillPattern` rendering on the diagram layer.
 * Each gradient (HorizontalCylinder / VerticalCylinder / Sphere) and hatch
 * (Horizontal / Vertical / Cross / Forward / Backward / CrossDiag) is baked to
 * a canvas `Texture` and mapped onto the shape `Graphics` — Chromatic snapshots
 * this so a regression in the bake or fill path is caught visually.
 *
 * The gradients render on a rectangle (cylinders) and an ellipse (sphere) to
 * exercise both the quad and the fan-from-centre UV paths; hatches render on
 * rectangles. The reference icons to eyeball against are
 * `Modelica.Fluid.Machines.BaseClasses.PartialPump` (HorizontalCylinder body,
 * Sphere rotor) and `Mechanics.Rotational.Components.Inertia`.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { EllipseShape, RectangleShape, Shape } from "@dicode/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import { renderLayers } from "../src/primitives/render-shape.js";

const FILL: [number, number, number] = [192, 192, 192];
const LINE: [number, number, number] = [70, 70, 70];

/** A small swatch shape for `pattern`, placed at grid cell (col, row). */
function swatch(
  pattern: string,
  col: number,
  row: number,
  kind: "rectangle" | "ellipse",
): Shape {
  const cell = 44;
  const pad = 6;
  const x = -90 + col * cell;
  const y = 70 - row * cell;
  const extent: [[number, number], [number, number]] = [
    [x + pad, y - cell + pad * 2],
    [x + cell - pad, y - pad],
  ];
  if (kind === "ellipse") {
    return {
      kind: "ellipse",
      extent,
      lineColor: LINE,
      fillColor: FILL,
      pattern: "Solid",
      fillPattern: pattern,
    } as EllipseShape;
  }
  return {
    kind: "rectangle",
    extent,
    lineColor: LINE,
    fillColor: FILL,
    pattern: "Solid",
    fillPattern: pattern,
  } as RectangleShape;
}

const GRADIENT_SHAPES: Shape[] = [
  swatch("HorizontalCylinder", 0, 0, "rectangle"),
  swatch("VerticalCylinder", 1, 0, "rectangle"),
  swatch("Sphere", 2, 0, "ellipse"),
];

const HATCH_SHAPES: Shape[] = [
  swatch("Horizontal", 0, 0, "rectangle"),
  swatch("Vertical", 1, 0, "rectangle"),
  swatch("Cross", 2, 0, "rectangle"),
  swatch("Forward", 0, 1, "rectangle"),
  swatch("Backward", 1, 1, "rectangle"),
  swatch("CrossDiag", 2, 1, "rectangle"),
];

interface StoryArgs {
  zoom: number;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/FillPatterns",
  argTypes: {
    zoom: { control: { type: "range", min: 20, max: 200, step: 5 } },
  },
  args: { zoom: 110 },
};
export default meta;

type Story = StoryObj<StoryArgs>;

function sceneWith(shapes: Shape[], zoom: number): TemplateResult {
  return html`
    <div class="om-story">
      <div class="om-story-canvas-host">
        <om-scene .zoom=${zoom}>
          <om-grid-axis .extent=${500}></om-grid-axis>
          ${renderLayers([{ from: "demo", shapes }], 0)}
        </om-scene>
      </div>
    </div>
  `;
}

/** HorizontalCylinder / VerticalCylinder / Sphere gradients. */
export const Gradients: Story = {
  render: ({ zoom }): TemplateResult => sceneWith(GRADIENT_SHAPES, zoom),
};

/** Horizontal / Vertical / Cross / Forward / Backward / CrossDiag hatches. */
export const Hatches: Story = {
  render: ({ zoom }): TemplateResult => sceneWith(HATCH_SHAPES, zoom),
};
