import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { RectangleShape } from "@modelica-wrapper/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledQuad,
  buildStroke,
  extentToRect,
} from "./shape-utils.js";

/**
 * `<om-rectangle>` — one Modelica `RectangleShape`. Renders a filled
 * quad (when `fillPattern` is not `"None"`) plus a stroked outline.
 * `radius` (rounded corners) is not implemented yet — flagged in the
 * renderer-parity TODOs; the dominant case is sharp corners.
 */
@customElement("om-rectangle")
export class OmRectangle extends OmShapePrimitive {
  @property({ attribute: false })
  shape: RectangleShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override buildMeshes(parent: TransformNode, z: number): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const scene = parent.getScene();
    const { x, y, width, height } = extentToRect(s.extent);
    if (width <= 0 || height <= 0) {
      return;
    }

    const baseName = `om-rectangle.${this.zOrder}`;
    if (s.fillPattern !== "None" && s.fillColor) {
      this.resources.push(
        buildFilledQuad(
          scene,
          parent,
          x + width / 2,
          y + height / 2,
          width,
          height,
          s.fillColor,
          z,
          `${baseName}.fill`,
        ),
      );
    }

    const corners: ReadonlyArray<readonly [number, number]> = [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
      [x, y],
    ];
    const stroke = buildStroke(
      scene,
      parent,
      corners,
      s.lineColor ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
    );
    if (stroke) {
      this.resources.push(stroke);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-rectangle": OmRectangle;
  }
}
