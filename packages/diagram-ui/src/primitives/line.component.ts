import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { Extent, LineShape, Point } from "@dicode/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  buildStroke,
  graphicItemNode,
} from "./shape-utils.js";

/** Axis-aligned bounding extent of a point list. */
function pointsExtent(points: Point[]): Extent {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

/**
 * `<om-line>` — one Modelica `LineShape`. Pure polyline; no fill side.
 * `lineThickness` is reserved on the Modelica side but ignored here —
 * GL_LINES caps at 1px in WebGL, which matches OMEdit's typical
 * appearance for the default thickness range.
 */
@customElement("om-line")
export class OmLine extends OmShapePrimitive {
  @property({ attribute: false })
  shape: LineShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override entityKind(): string {
    return "line";
  }

  protected override entityBounds(): {
    extent: Extent;
    origin?: Point | undefined;
    rotation?: number | undefined;
    points?: Point[] | undefined;
  } | null {
    const s = this.shape;
    if (!s || s.points.length < 2) {
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
    if (!s || s.points.length < 2) {
      return;
    }
    const gi = graphicItemNode(parent, s, `om-line.${this.zOrder}.gi`);
    const stroke = buildStroke(
      parent.getScene(),
      gi.node,
      s.points,
      s.color ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z,
      `om-line.${this.zOrder}`,
    );
    if (stroke) {
      this.resources.push(stroke);
    }
    this.resources.push(gi);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-line": OmLine;
  }
}
