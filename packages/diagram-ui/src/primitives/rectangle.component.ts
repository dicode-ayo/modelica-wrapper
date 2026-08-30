import { customElement, property } from "lit/decorators.js";
import type { Container } from "pixi.js";
import type { RectangleShape } from "@dicode/omc-client";
import { fillSpec } from "@dicode/diagram-svg";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import {
  DEFAULT_LINE_COLOR,
  STROKE_Z_DELTA,
  buildBorderBevel,
  buildFilledRect,
  buildStroke,
  clampCornerRadius,
  extentToRect,
  roundedRectRing,
} from "./shape-utils.js";

/**
 * `<om-rectangle>` — one Modelica `RectangleShape`. Renders a filled
 * region (when `fillPattern` is not `"None"`) plus a stroked outline, or
 * a two-tone bevel frame instead of the outline when `borderPattern`
 * requests one. A positive `radius` rounds the corners, clamped to half
 * the shorter side.
 */
@customElement("om-rectangle")
export class OmRectangle extends OmShapePrimitive {
  @property({ attribute: false })
  shape: RectangleShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override entityKind(): string {
    return "rectangle";
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
    if (!s) {
      return null;
    }
    // A bevel is drawn even with a `"None"` line pattern — the pattern
    // gates the pen, `borderPattern` the shade frame — and its edge width
    // rides the same floor as a stroke.
    const beveled = s.borderPattern !== undefined && s.borderPattern !== "None";
    if (!beveled && s.pattern === "None") {
      return null;
    }
    return { thickness: s.lineThickness };
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

    const renderer = this.renderer();
    const baseName = `om-rectangle.${this.zOrder}`;
    const root = this.graphicRoot(
      parent,
      s,
      `${baseName}.gi`,
      inEntityFrame,
      z,
    );
    const radius = clampCornerRadius(s.radius, width, height);
    const corners = roundedRectRing(x, y, width, height, radius);
    const fill = fillSpec({
      fillColor: s.fillColor,
      lineColor: s.lineColor,
      pattern: s.fillPattern,
    });
    if (fill.kind !== "none") {
      this.resources.push(
        buildFilledRect(
          renderer,
          root,
          { x, y, width, height },
          radius,
          fill,
          z,
          `${baseName}.fill`,
        ),
      );
    }

    const strokeOpts = {
      thickness: s.lineThickness,
      lineThicknessScale: this.lineThicknessScale,
      worldPerPixel: this.sceneCtx?.worldPerPixel(),
    };
    // `borderPattern` asks for a shaded bevel, not an outline — the
    // `lineColor` stroke is replaced, never drawn underneath (a solid
    // outline is exactly what the annotation opted out of). The bevel
    // frame is always square: Qt's shade panel ignores the corner radius.
    const bevel = buildBorderBevel(
      root,
      { x, y, width, height },
      s.borderPattern ?? "None",
      s.fillColor,
      z + STROKE_Z_DELTA,
      baseName,
      strokeOpts,
    );
    if (bevel) {
      this.resources.push(bevel);
      return;
    }
    const stroke = buildStroke(
      root,
      corners,
      s.lineColor ?? DEFAULT_LINE_COLOR,
      s.pattern,
      z + STROKE_Z_DELTA,
      `${baseName}.stroke`,
      strokeOpts,
    );
    if (stroke) {
      this.resources.push(stroke);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-rectangle": OmRectangle;
  }
}
