import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { PolygonShape } from "@dicode/omc-client";
import { fillSpec } from "@dicode/diagram-svg";

import { OmShapePrimitive, type EntityBounds } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledPolygon,
  buildStroke,
  graphicItemNode,
  pointsExtent,
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

  protected override entityKind(): string {
    return "polygon";
  }

  protected override entityBounds(): EntityBounds | null {
    const s = this.shape;
    if (!s || s.points.length < 3) {
      return null;
    }
    return {
      extent: pointsExtent(s.points),
      origin: s.origin,
      rotation: s.rotation,
      points: s.points,
    };
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
    const gi = graphicItemNode(parent, s, `${baseName}.gi`);
    const root = gi.node;
    const fill = fillSpec({
      fillColor: s.fillColor,
      lineColor: s.lineColor,
      pattern: s.fillPattern,
    });
    if (fill.kind !== "none") {
      const filled = buildFilledPolygon(
        scene,
        root,
        points,
        fill,
        z,
        `${baseName}.fill`,
      );
      if (filled) {
        this.resources.push(filled);
      }
    }

    const strokePoints = [...points, points[0]!];
    const stroke = buildStroke(
      scene,
      root,
      strokePoints,
      s.lineColor ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
    );
    if (stroke) {
      this.resources.push(stroke);
    }
    this.resources.push(gi);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-polygon": OmPolygon;
  }
}
