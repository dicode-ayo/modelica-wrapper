import { customElement, property } from "lit/decorators.js";
import type { Extent, Placement, Shape } from "@dicode/omc-client";

import { OmShapeElement } from "../base/shape-element.js";

/**
 * World-z offset applied to the host class's own shapes so they sit behind
 * every component / connector but IN FRONT of the grid's extent-rectangle.
 * Camera at -Z, so larger z = farther:
 *
 *   extent-rect  z = +0.10  (white background, drawn by `<om-grid-axis>`)
 *   grid lines   z = +0.05
 *   host shapes  z = +0.025 ← us
 *   components   z =  0.0   (default `OmShapeNode` placement)
 *
 * Shared by the shape visuals and this entity's hit plane so picks land in
 * the same depth band and a component always wins a pick over a shape
 * beneath it — the depth test alone gives topmost-wins, no picker change.
 */
export const HOST_SHAPE_Z_BIAS = 0.025;

/** Bounding extent of a shape: its own `extent`, or the bbox of its vertices. */
function shapeExtent(shape: Shape): Extent {
  if (shape.kind !== "line" && shape.kind !== "polygon") {
    return shape.extent;
  }
  const pts = shape.points;
  if (pts.length === 0) {
    return [
      [0, 0],
      [0, 0],
    ];
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

/**
 * `<om-host-shape>` — makes one of the host class's own drawn primitives
 * a first-class, selectable entity. The shape's *visual* is still drawn by
 * the host's `renderHostShapes` primitives; this element contributes only
 * the transparent pickable hit plane + selection/resize/rotate overlay,
 * sized to the shape's bounding extent and named `om-shape:<kind>:<index>`
 * so the interaction layer resolves it to a `shape:<kind>:<index>` key.
 */
@customElement("om-host-shape")
export class OmHostShape extends OmShapeElement {
  /** The drawn primitive this entity wraps. */
  @property({ attribute: false })
  shape: Shape | null = null;

  /** Position in the host's own-layer shape array — the key's index. */
  @property({ type: Number })
  index = 0;

  protected override babylonNodeName(): string {
    return this.shape
      ? `om-shape:${this.shape.kind}:${this.index}`
      : "om-shape";
  }

  protected override zOffset(): number {
    return HOST_SHAPE_Z_BIAS;
  }

  protected override resolvePlacement(): Placement {
    if (!this.shape) {
      return this.placement;
    }
    return {
      extent: shapeExtent(this.shape),
      origin: this.shape.origin,
      rotation: this.shape.rotation,
    };
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    // The Babylon node is created once and reused; a delete/reorder shifts
    // which (kind, index) this element renders, so keep the transform name
    // — the identity the picker reads — in sync with the current shape.
    const node = this.shapeNode;
    if (node) {
      node.transform.name = this.babylonNodeName();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-host-shape": OmHostShape;
  }
}
