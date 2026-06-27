import { customElement, property } from "lit/decorators.js";
import type { TransformNode } from "@babylonjs/core";
import type { LineShape } from "@dicode/omc-client";

import { OmShapePrimitive, type EntityBounds } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  buildStroke,
  pointsExtent,
} from "./shape-utils.js";
import { DEFAULT_ARROW_SIZE, buildArrowhead } from "./arrow-utils.js";

/**
 * `<om-line>` — one Modelica `LineShape`. Pure polyline with optional
 * arrowheads at each end (`arrow` / `arrowSize`). No fill side.
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
    const root = this.graphicRoot(
      parent,
      s,
      `om-line.${this.zOrder}.gi`,
      inEntityFrame,
    );
    const scene = parent.getScene();
    const color = s.color ?? DEFAULT_LINE_COLOR;
    const stroke = buildStroke(
      scene,
      root,
      s.points,
      color,
      s.pattern,
      z,
      `om-line.${this.zOrder}`,
    );
    if (stroke) {
      this.resources.push(stroke);
    }

    const [startKind, endKind] = s.arrow ?? ["None", "None"];
    const arrowSize = s.arrowSize ?? DEFAULT_ARROW_SIZE;

    const p0 = s.points[0];
    const p1 = s.points[1];
    if (p0 && p1 && startKind !== "None") {
      const a = buildArrowhead(
        scene,
        root,
        p0,
        p0[0] - p1[0],
        p0[1] - p1[1],
        arrowSize,
        startKind,
        color,
        z,
        `om-line.${this.zOrder}.arrow-start`,
      );
      if (a) this.resources.push(a);
    }

    const lastIdx = s.points.length - 1;
    const pLast = s.points[lastIdx];
    const pPrev = s.points[lastIdx - 1];
    if (pLast && pPrev && endKind !== "None") {
      const a = buildArrowhead(
        scene,
        root,
        pLast,
        pLast[0] - pPrev[0],
        pLast[1] - pPrev[1],
        arrowSize,
        endKind,
        color,
        z,
        `om-line.${this.zOrder}.arrow-end`,
      );
      if (a) this.resources.push(a);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-line": OmLine;
  }
}
