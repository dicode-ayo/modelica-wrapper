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
  graphicItemNode,
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
    // Per-shape origin/rotation (issue #76 item 15): parent the meshes under
    // a transform node when the shape carries a non-default origin/rotation.
    const gi = graphicItemNode(parent, s, `${baseName}.gi`);
    const root = gi.node;
    if (s.fillPattern !== "None" && s.fillColor) {
      this.resources.push(
        buildFilledQuad(
          scene,
          root,
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
    // Dispose the wrapper node last (after its child meshes).
    this.resources.push(gi);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-rectangle": OmRectangle;
  }
}
