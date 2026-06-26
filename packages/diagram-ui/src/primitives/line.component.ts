import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { LineShape } from "@dicode/omc-client";

import { OmShapePrimitive, type EntityBounds } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  buildStroke,
  graphicItemNode,
  pointsExtent,
} from "./shape-utils.js";

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

  protected override entityBounds(): EntityBounds | null {
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

  protected override buildMeshes(
    parent: TransformNode,
    z: number,
    inEntityFrame = false,
  ): void {
    const s = this.shape;
    if (!s || s.points.length < 2) {
      return;
    }
    let root = parent;
    if (!inEntityFrame) {
      const gi = graphicItemNode(parent, s, `om-line.${this.zOrder}.gi`);
      root = gi.node;
      this.resources.push(gi);
    }
    const stroke = buildStroke(
      parent.getScene(),
      root,
      s.points,
      s.color ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z,
      `om-line.${this.zOrder}`,
    );
    if (stroke) {
      this.resources.push(stroke);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-line": OmLine;
  }
}
