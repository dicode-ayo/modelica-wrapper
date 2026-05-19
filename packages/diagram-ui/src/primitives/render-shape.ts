import { html, type TemplateResult } from "lit";
import type { IconLayer, Shape } from "@modelica-wrapper/omc-client";

import "./rectangle.component.js";
import "./polygon.component.js";
import "./line.component.js";
import "./ellipse.component.js";
import "./text.component.js";
import "./bitmap.component.js";

/**
 * Render one Modelica `Shape` as the matching `<om-*>` primitive. Used
 * in two places: by `OmShapeElement` to render a component's own icon
 * shapes, and by `OmGraphicalLayout` to render the host class's own
 * diagram-level shapes. Both call paths share the switch — they only
 * differ in the `zBias` they pass.
 */
export function renderShape(
  shape: Shape,
  zOrder: number,
  zBias: number = 0,
): TemplateResult {
  switch (shape.kind) {
    case "rectangle":
      return html`<om-rectangle
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
      ></om-rectangle>`;
    case "polygon":
      return html`<om-polygon
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
      ></om-polygon>`;
    case "line":
      return html`<om-line
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
      ></om-line>`;
    case "ellipse":
      return html`<om-ellipse
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
      ></om-ellipse>`;
    case "text":
      return html`<om-text
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
      ></om-text>`;
    case "bitmap":
      return html`<om-bitmap
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
      ></om-bitmap>`;
    default: {
      const _exhaustive: never = shape;
      void _exhaustive;
      return html``;
    }
  }
}

/**
 * Walk every shape in every layer in source order (ancestor-first /
 * host-last so later shapes paint on top), assigning each a flat
 * `zOrder` index, and emit the corresponding `<om-*>` primitive
 * templates. `zBias` is applied uniformly to every emitted primitive.
 */
export function renderLayers(
  layers: ReadonlyArray<IconLayer>,
  zBias: number = 0,
): TemplateResult[] {
  const out: TemplateResult[] = [];
  let zOrder = 0;
  for (const layer of layers) {
    for (const shape of layer.shapes) {
      out.push(renderShape(shape, zOrder, zBias));
      zOrder++;
    }
  }
  return out;
}
