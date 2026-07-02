import { customElement, property } from "lit/decorators.js";
import type { Container } from "pixi.js";
import type { PolygonShape } from "@dicode/omc-client";
import { fillSpec } from "@dicode/diagram-svg";

import { OmShapePrimitive, type EntityBounds } from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildFilledPolygon,
  buildStroke,
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

  protected override dashPattern(): string | undefined {
    return this.shape?.pattern;
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

  protected override buildMeshes(
    parent: Container,
    z: number,
    inEntityFrame = false,
  ): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const points = stripClosingDuplicate(s.points);
    const first = points[0];
    if (points.length < 3 || first === undefined) {
      return;
    }

    const renderer = this.renderer();
    const baseName = `om-polygon.${this.zOrder}`;
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
      const filled = buildFilledPolygon(
        renderer,
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

    const strokePoints = [...points, first];
    const stroke = buildStroke(
      root,
      strokePoints,
      s.lineColor ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
      s.lineThickness,
      this.lineThicknessScale,
      this.sceneCtx?.worldPerPixel(),
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
