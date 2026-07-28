import { html, type TemplateResult } from "lit";
import type { IconLayer, Shape } from "@dicode/omc-client";

import "./rectangle.component.js";
import "./polygon.component.js";
import "./line.component.js";
import "./ellipse.component.js";
import "./text.component.js";
import "./bitmap.component.js";

/**
 * Makes a rendered shape a first-class editable entity: `index` is its
 * `shape:` key index in the host's own layer; `selected` drives the
 * selection overlay. Omitted for non-interactive paint (icon shapes,
 * inherited host shapes).
 */
export interface ShapeEntity {
  index: number;
  selected: boolean;
  /**
   * Whether the entity offers edit affordances — the hover-revealed hit tube
   * and vertex handles. `false` keeps it pickable and selectable without
   * them, which is what a read-only class needs: selecting a graphic to copy
   * it is not an edit.
   */
  editHandles?: boolean;
}

/**
 * Render one Modelica `Shape` as the matching `<om-*>` primitive. Used by
 * `OmShapeElement` for a component's icon shapes and by `OmGraphicalLayout`
 * for the host class's diagram shapes. Passing `entity` makes it editable —
 * the primitive then owns its own hit geometry + selection overlay;
 * otherwise it's pure paint.
 */
export function renderShape(
  shape: Shape,
  zOrder: number,
  zBias: number = 0,
  entity?: ShapeEntity,
): TemplateResult {
  // Per-shape GraphicItem visibility (§18.6, issue #76 item 15): a
  // `visible=false` graphic is dropped entirely. origin/rotation are applied
  // inside each primitive via the shared OmShapePrimitive transform.
  if (shape.visible === false) return html``;
  const editable = entity !== undefined;
  const index = entity?.index ?? 0;
  const selected = entity?.selected ?? false;
  const editHandles = entity?.editHandles !== false;
  switch (shape.kind) {
    case "rectangle":
      return html`<om-rectangle
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
        ?editable=${editable}
        .editHandles=${editHandles}
        .entityIndex=${index}
        ?selected=${selected}
      ></om-rectangle>`;
    case "polygon":
      return html`<om-polygon
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
        ?editable=${editable}
        .editHandles=${editHandles}
        .entityIndex=${index}
        ?selected=${selected}
      ></om-polygon>`;
    case "line":
      return html`<om-line
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
        ?editable=${editable}
        .editHandles=${editHandles}
        .entityIndex=${index}
        ?selected=${selected}
      ></om-line>`;
    case "ellipse":
      return html`<om-ellipse
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
        ?editable=${editable}
        .editHandles=${editHandles}
        .entityIndex=${index}
        ?selected=${selected}
      ></om-ellipse>`;
    case "text":
      return html`<om-text
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
        ?editable=${editable}
        .editHandles=${editHandles}
        .entityIndex=${index}
        ?selected=${selected}
      ></om-text>`;
    case "bitmap":
      return html`<om-bitmap
        .shape=${shape}
        .zOrder=${zOrder}
        .zBias=${zBias}
        ?editable=${editable}
        .editHandles=${editHandles}
        .entityIndex=${index}
        ?selected=${selected}
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
