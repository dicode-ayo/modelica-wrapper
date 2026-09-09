import { customElement, property } from "lit/decorators.js";
import type { Container } from "pixi.js";
import type { LineShape, Point } from "@dicode/omc-client";
import { isBezierSmooth, smoothLinePoints } from "@dicode/diagram-svg";

import { OmShapePrimitive, type EntityBounds } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  buildStroke,
  pointsExtent,
  resolveStrokeWidth,
} from "./shape-utils.js";
import { DEFAULT_ARROW_SIZE, buildArrowhead } from "./arrow-utils.js";

/**
 * `<om-line>` — one Modelica `LineShape`. Polyline with optional arrowheads
 * at each end (`arrow` / `arrowSize`); no fill side. `thickness` is honored
 * in icon space via the shared stroke (`buildStroke`).
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

  protected override dashPattern(): string | undefined {
    return this.shape?.pattern;
  }

  protected override strokeThickness(): {
    thickness: number | undefined;
  } | null {
    const s = this.shape;
    if (!s) {
      return null;
    }
    // Arrowhead outlines ride the stroke width even when the line pattern
    // is `"None"`, so only a line with neither stroke nor arrows opts out.
    const [start, end] = s.arrow ?? ["None", "None"];
    if (s.pattern === "None" && start === "None" && end === "None") {
      return null;
    }
    return { thickness: s.thickness };
  }

  /** The polyline actually stroked: the vertices, or the flattened curve
   *  under `Smooth.Bezier`. */
  private drawnPath(s: LineShape): Point[] {
    return isBezierSmooth(s.smooth) ? smoothLinePoints(s.points) : s.points;
  }

  protected override entityBounds(): EntityBounds | null {
    const s = this.shape;
    if (!s || s.points.length < 2) {
      return null;
    }
    // The control polygon still bounds the curve, which lies inside its hull.
    return {
      extent: pointsExtent(s.points),
      origin: s.origin,
      rotation: s.rotation,
      points: s.points,
      drawnPath: this.drawnPath(s),
    };
  }

  protected override buildMeshes(
    parent: Container,
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
      z,
    );
    const color = s.color ?? DEFAULT_LINE_COLOR;
    const stroke = buildStroke(
      root,
      this.drawnPath(s),
      color,
      s.pattern,
      z,
      `om-line.${this.zOrder}`,
      {
        thickness: s.thickness,
        lineThicknessScale: this.lineThicknessScale,
        worldPerPixel: this.sceneCtx?.worldPerPixel(),
      },
    );
    if (stroke) {
      this.resources.push(stroke);
    }

    const [startKind, endKind] = s.arrow ?? ["None", "None"];
    const arrowSize = s.arrowSize ?? DEFAULT_ARROW_SIZE;
    const strokeWidth = resolveStrokeWidth(
      root,
      s.thickness,
      this.lineThicknessScale,
      this.sceneCtx?.worldPerPixel(),
    );

    const addArrow = (
      tip: readonly [number, number] | undefined,
      back: readonly [number, number] | undefined,
      kind: string,
      suffix: string,
    ): void => {
      if (!tip || !back || kind === "None") return;
      const a = buildArrowhead(
        root,
        tip,
        tip[0] - back[0],
        tip[1] - back[1],
        arrowSize,
        kind,
        color,
        z,
        `om-line.${this.zOrder}.${suffix}`,
        strokeWidth,
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
