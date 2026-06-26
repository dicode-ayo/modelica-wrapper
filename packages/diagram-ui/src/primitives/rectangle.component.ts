import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
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
  buildFilledPolygon,
  buildFilledQuad,
  buildStroke,
  clampCornerRadius,
  extentToRect,
  roundedRectRing,
  stripClosingDuplicate,
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
    parent: TransformNode,
    z: number,
    inEntityFrame = false,
  ): void {
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
    const root = this.graphicRoot(parent, s, `${baseName}.gi`, inEntityFrame);
    const radius = clampCornerRadius(s.radius, width, height);
    const corners = roundedRectRing(x, y, width, height, radius);
    const fill = fillSpec({
      fillColor: s.fillColor,
      lineColor: s.lineColor,
      pattern: s.fillPattern,
    });
    if (fill.kind !== "none") {
      // A degenerate rounded ring triangulates to null; the shape then renders
      // as outline only rather than a missing region.
      const filled =
        radius > 0
          ? buildFilledPolygon(
              scene,
              root,
              stripClosingDuplicate(corners),
              fill,
              z,
              `${baseName}.fill`,
            )
          : buildFilledQuad(
              scene,
              root,
              { x, y, width, height },
              fill,
              z,
              `${baseName}.fill`,
            );
      if (filled) {
        this.resources.push(filled);
      }
    }

    const stroke = buildStroke(
      scene,
      root,
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
