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

    const addArrow = (
      tip: readonly [number, number] | undefined,
      back: readonly [number, number] | undefined,
      kind: string,
      suffix: string,
    ): void => {
      if (!tip || !back || kind === "None") return;
      const a = buildArrowhead(
        scene,
        root,
        tip,
        tip[0] - back[0],
        tip[1] - back[1],
        arrowSize,
        kind,
        color,
        z,
        `om-line.${this.zOrder}.${suffix}`,
      );
      if (a) this.resources.push(a);
    };

    addArrow(s.points[0], s.points[1], startKind, "arrow-start");
    const lastIdx = s.points.length - 1;
    addArrow(s.points[lastIdx], s.points[lastIdx - 1], endKind, "arrow-end");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-line": OmLine;
  }
}
