import { customElement, property } from "lit/decorators.js";
import type { Container } from "pixi.js";
import type { EllipseShape } from "@dicode/omc-client";
import { ellipseArc, ellipseArcPoints, fillSpec } from "@dicode/diagram-svg";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledEllipse,
  buildFilledPolygon,
  buildStroke,
  extentToRect,
  filledShapeStroke,
  stripClosingDuplicate,
} from "./shape-utils.js";

/**
 * `<om-ellipse>` — one Modelica `EllipseShape`. Strokes the outline
 * `ellipseArcPoints` samples, spanning `startAngle` to `endAngle` and closed
 * according to `closure`. A full sweep fills through Pixi's own ellipse
 * rather than that polyline, leaving every existing icon's fill untouched.
 */
@customElement("om-ellipse")
export class OmEllipse extends OmShapePrimitive {
  @property({ attribute: false })
  shape: EllipseShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override entityKind(): string {
    return "ellipse";
  }

  protected override entityBounds(): EntityBounds | null {
    return this.shape ? extentEntityBounds(this.shape) : null;
  }

  protected override dashPattern(): string | undefined {
    return this.shape?.pattern;
  }

  protected override strokeThickness(): {
    thickness: number | undefined;
  } | null {
    return filledShapeStroke(this.shape);
  }

  protected override buildMeshes(
    parent: Container,
    z: number,
    inEntityFrame = false,
  ): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const rect = extentToRect(s.extent);
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const arc = ellipseArc(rect, s);
    const points = ellipseArcPoints(arc);

    const renderer = this.renderer();
    const baseName = `om-ellipse.${this.zOrder}`;
    const root = this.graphicRoot(
      parent,
      s,
      `${baseName}.gi`,
      inEntityFrame,
      z,
    );
    const fill = fillSpec({
      fillColor: s.fillColor,
      lineColor: s.lineColor,
      pattern: s.fillPattern,
    });
    if (arc.filled && fill.kind !== "none") {
      const filled = arc.full
        ? buildFilledEllipse(
            renderer,
            root,
            arc.cx,
            arc.cy,
            arc.rx,
            arc.ry,
            rect,
            fill,
            z,
            `${baseName}.fill`,
          )
        : buildFilledPolygon(
            renderer,
            root,
            stripClosingDuplicate(points),
            fill,
            z,
            `${baseName}.fill`,
          );
      if (filled) {
        this.resources.push(filled);
      }
    }

    const stroke = buildStroke(
      root,
      points,
      s.lineColor ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
      {
        thickness: s.lineThickness,
        lineThicknessScale: this.lineThicknessScale,
        worldPerPixel: this.sceneCtx?.worldPerPixel(),
      },
    );
    if (stroke) {
      this.resources.push(stroke);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-ellipse": OmEllipse;
  }
}
