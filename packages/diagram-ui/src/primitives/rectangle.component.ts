import { customElement, property } from "lit/decorators.js";
import type { Container } from "pixi.js";
import type { RectangleShape } from "@dicode/omc-client";
import { fillSpec } from "@dicode/diagram-svg";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledRect,
  buildStroke,
  clampCornerRadius,
  extentToRect,
  roundedRectRing,
} from "./shape-utils.js";

/**
 * `<om-rectangle>` — one Modelica `RectangleShape`. Renders a filled
 * region (when `fillPattern` is not `"None"`) plus a stroked outline.
 * A positive `radius` rounds the corners, clamped to half the shorter
 * side.
 */
@customElement("om-rectangle")
export class OmRectangle extends OmShapePrimitive {
  @property({ attribute: false })
  shape: RectangleShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override entityKind(): string {
    return "rectangle";
  }

  protected override entityBounds(): EntityBounds | null {
    return this.shape ? extentEntityBounds(this.shape) : null;
  }

  protected override buildMeshes(
    parent: Container,
    z: number,
    inEntityFrame = false,
  ): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const { x, y, width, height } = extentToRect(s.extent);
    if (width <= 0 || height <= 0) {
      return;
    }

    const renderer = this.renderer();
    const baseName = `om-rectangle.${this.zOrder}`;
    const root = this.graphicRoot(
      parent,
      s,
      `${baseName}.gi`,
      inEntityFrame,
      z,
    );
    const radius = clampCornerRadius(s.radius, width, height);
    const corners = roundedRectRing(x, y, width, height, radius);
    const fill = fillSpec({
      fillColor: s.fillColor,
      lineColor: s.lineColor,
      pattern: s.fillPattern,
    });
    if (fill.kind !== "none") {
      this.resources.push(
        buildFilledRect(
          renderer,
          root,
          { x, y, width, height },
          radius,
          fill,
          z,
          `${baseName}.fill`,
        ),
      );
    }

    const stroke = buildStroke(
      root,
      corners,
      s.lineColor ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
      s.lineThickness,
      this.lineThicknessScale,
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
