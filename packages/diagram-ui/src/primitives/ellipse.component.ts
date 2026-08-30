import { customElement, property } from "lit/decorators.js";
import type { Container } from "pixi.js";
import type { EllipseShape } from "@dicode/omc-client";
import { fillSpec } from "@dicode/diagram-svg";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledEllipse,
  buildStroke,
  extentToRect,
} from "./shape-utils.js";

const ELLIPSE_SEGMENTS = 64;

/**
 * `<om-ellipse>` — one Modelica `EllipseShape`. Approximates the
 * ellipse as a 64-segment fan for the fill and a closed polyline for
 * the stroke. `startAngle` / `endAngle` / `closure` are not yet
 * honoured — we always emit the full ellipse to match diagram-svg v1.
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
    const s = this.shape;
    return s && s.pattern !== "None" ? { thickness: s.lineThickness } : null;
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
    const { x, y, width, height } = extentToRect(s.extent);
    if (width <= 0 || height <= 0) {
      return;
    }
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rx = width / 2;
    const ry = height / 2;

    const ring: Array<[number, number]> = [];
    for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
      const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
      ring.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }

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
    if (fill.kind !== "none") {
      this.resources.push(
        buildFilledEllipse(
          renderer,
          root,
          cx,
          cy,
          rx,
          ry,
          { x, y, width, height },
          fill,
          z,
          `${baseName}.fill`,
        ),
      );
    }

    const firstRingPoint = ring[0];
    const strokePoints =
      firstRingPoint === undefined ? ring : [...ring, firstRingPoint];
    const stroke = buildStroke(
      root,
      strokePoints,
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
