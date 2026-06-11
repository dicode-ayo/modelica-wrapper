import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { LineShape } from "@dicode/omc-client";

import { OmShapePrimitive } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  buildStroke,
  graphicItemNode,
} from "./shape-utils.js";

/**
 * `<om-line>` — one Modelica `LineShape`. Pure polyline; no fill side.
 */
@customElement("om-line")
export class OmLine extends OmShapePrimitive {
  @property({ attribute: false })
  shape: LineShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
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
      z,
      `om-line.${this.zOrder}`,
      {
        thickness: s.thickness,
        thicknessScale: this.lineThicknessScale,
        pattern: s.pattern,
      },
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
