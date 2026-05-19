import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { PolygonShape } from "@modelica-wrapper/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledPolygon,
  buildStroke,
  stripClosingDuplicate,
} from "./shape-utils.js";

/**
 * `<om-polygon>` — one Modelica `PolygonShape`. Triangulates a fill
 * (when `fillPattern` is not `"None"`) and closes the path to render
 * the outline.
 */
@customElement("om-polygon")
export class OmPolygon extends OmShapePrimitive {
  @property({ attribute: false })
  shape: PolygonShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override buildMeshes(parent: TransformNode, z: number): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const scene = parent.getScene();
    const points = stripClosingDuplicate(s.points);
    if (points.length < 3) {
      return;
    }

    const baseName = `om-polygon.${this.zOrder}`;
    if (s.fillPattern !== "None" && s.fillColor) {
      const fill = buildFilledPolygon(
        scene,
        parent,
        points,
        s.fillColor,
        z,
        `${baseName}.fill`,
      );
      if (fill) {
        this.resources.push(fill);
      }
    }

    const strokePoints = [...points, points[0]!];
    const stroke = buildStroke(
      scene,
      parent,
      strokePoints,
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
    "om-polygon": OmPolygon;
  }
}
