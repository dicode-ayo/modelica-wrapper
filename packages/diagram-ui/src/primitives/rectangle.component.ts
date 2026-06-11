import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { RectangleShape } from "@dicode/omc-client";
import { fillSpec } from "@dicode/diagram-svg";

import { OmShapePrimitive } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledPolygon,
  buildFilledQuad,
  buildStroke,
  clampCornerRadius,
  extentToRect,
  graphicItemNode,
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
    // Per-shape origin/rotation (issue #76 item 15): parent the meshes under
    // a transform node when the shape carries a non-default origin/rotation.
    const gi = graphicItemNode(parent, s, `${baseName}.gi`);
    const root = gi.node;
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
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
      {
        thickness: s.lineThickness,
        thicknessScale: this.lineThicknessScale,
        pattern: s.pattern,
      },
    );
    if (stroke) {
      this.resources.push(stroke);
    }
    // Dispose the wrapper node last (after its child meshes).
    this.resources.push(gi);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-rectangle": OmRectangle;
  }
}
