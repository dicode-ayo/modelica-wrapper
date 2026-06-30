import { Circle, Container, Graphics, Rectangle } from "pixi.js";

import type { Point } from "@dicode/omc-client";

import { worldScaleXY } from "../scene/ortho-camera.js";
import { tagEntity, type EntityKind } from "../interaction/node-keys.js";
import type { SceneContext } from "../scene/scene-context.js";

/** Accent blue shared by the selection outline stroke and rotate handle. */
const SELECTION_BLUE = 0x6199fa;
/** Near-white fill of the corner resize handles. */
const HANDLE_FILL = 0xf5faff;
/** Near-black of a poly vertex dot — matches the connection junction disc. */
const VERTEX_DOT_COLOR = 0x1a1a2e;
/** Vertex-dot radius in diagram units — matches the connection waypoint disc
 *  (and the hit tube) so the dot is a real grab target that grows with zoom,
 *  not a hard-to-hit screen-pixel speck the line-body drag wins over. */
const VERTEX_DOT_RADIUS = 1.5;

/** zIndex bands inside an entity container: outline over the icon, handles
 *  over the outline (no depth buffer — higher draws on top, and the pick
 *  returns the topmost interactive container). */
const OUTLINE_Z_INDEX = 10;
const HANDLE_Z_INDEX = 20;
/** Highlight outline drawn above the highlighted container's own content. */
const HIGHLIGHT_Z_INDEX = 1000;

/**
 * Per-scene highlight registry with refcounted lifecycle.
 *
 * Pixi has no built-in glow pass, so a highlight is a hand-drawn outline
 * traced around the target container's bounds. The registry is keyed by
 * the stage container and maps each highlighted container to its outline
 * `Graphics`, so a colour change recolours in place and a removal destroys
 * the outline. Headless scenes (`renderer === null`) skip the visual — the
 * `selected` state flag still drives behaviour, only the outline is absent.
 *
 * `outlines` is a `WeakMap` so an entity destroyed while still highlighted
 * (delete-while-hovered, no explicit clear) drops its entry instead of
 * pinning the dead container for the life of the scene.
 */
interface HighlightState {
  outlines: WeakMap<Container, Graphics>;
}

const highlightStates = new WeakMap<Container, HighlightState>();

function highlightStateFor(stage: Container): HighlightState {
  let state = highlightStates.get(stage);
  if (!state) {
    state = { outlines: new WeakMap() };
    highlightStates.set(stage, state);
  }
  return state;
}

/**
 * Toggle a container's highlight outline. Passing `color` adds (or
 * recolours) the outline; passing `null` removes it. A no-op when the
 * scene is renderer-less.
 */
export function setHighlight(
  ctx: SceneContext,
  target: Container,
  color: number | null,
): void {
  if (ctx.renderer === null) {
    return;
  }
  const state = highlightStateFor(ctx.stage);
  const existing = state.outlines.get(target);

  if (color === null) {
    if (!existing) {
      return;
    }
    existing.destroy();
    state.outlines.delete(target);
    ctx.requestRender();
    return;
  }

  const outline = existing ?? new Graphics({ label: "om-highlight" });
  if (!existing) {
    outline.eventMode = "none";
    outline.zIndex = HIGHLIGHT_Z_INDEX;
    target.addChild(outline);
    state.outlines.set(target, outline);
  }
  drawHighlight(outline, target, color, ctx.worldPerPixel());
  ctx.requestRender();
}

function drawHighlight(
  outline: Graphics,
  target: Container,
  color: number,
  worldPerPixel: number,
): void {
  // Clear before measuring so the (cleared) outline contributes no bounds
  // and can't feed its own width back into the traced rectangle.
  outline.clear();
  const b = target.getLocalBounds();
  const s = worldScaleXY(target);
  const widthLocal = (3 * worldPerPixel) / Math.sqrt(s.x * s.y);
  const pad = widthLocal;
  outline
    .rect(b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad)
    .stroke({ width: widthLocal, color, alignment: 0.5 });
}

/**
 * Crisp rectangular outline around a shape's icon extent. A single closed
 * `Graphics` rect stroke; the 4-unit width is in world units so it rides the
 * view transform and zoom-attenuates. Cheap to create and dispose; redrawn
 * on size change the same way `ResizeHandles` is.
 */
export class SelectionOutline {
  private readonly outline: Graphics;

  constructor(
    private readonly ctx: SceneContext,
    parent: Container,
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
    private readonly color: number = SELECTION_BLUE,
    private readonly widthUnits: number = 4,
  ) {
    this.outline = new Graphics({ label: "om-selection-outline" });
    this.outline.eventMode = "none";
    this.outline.zIndex = OUTLINE_Z_INDEX;
    this.outline.visible = false;
    parent.addChild(this.outline);
    this.draw(iconWidth, iconHeight, iconCx, iconCy);
  }

  private draw(
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
  ): void {
    this.outline.clear();
    this.outline
      .rect(
        iconCx - iconWidth / 2,
        iconCy - iconHeight / 2,
        iconWidth,
        iconHeight,
      )
      .stroke({ width: this.widthUnits, color: this.color, alignment: 0.5 });
  }

  /** Redraw geometry after the icon extent changes. */
  resize(
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
  ): void {
    this.draw(iconWidth, iconHeight, iconCx, iconCy);
    if (this.outline.visible) {
      this.ctx.requestRender();
    }
  }

  setVisible(visible: boolean): void {
    if (this.outline.visible === visible) {
      return;
    }
    this.outline.visible = visible;
    this.ctx.requestRender();
  }

  dispose(): void {
    this.outline.destroy();
  }
}

/**
 * Four corner resize handles for a single shape node. Sized in screen
 * pixels (kept constant by `rescale()`, which the host calls on every
 * view change — zoom or pan).
 */
export class ResizeHandles {
  private readonly handles: Graphics[] = [];
  private currentVisible = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly parent: Container,
    iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
    private readonly handlePixelSize: number = 8,
  ) {
    const corners: Array<["tl" | "tr" | "br" | "bl", number, number]> = [
      ["tl", iconCx - iconWidth / 2, iconCy + iconHeight / 2],
      ["tr", iconCx + iconWidth / 2, iconCy + iconHeight / 2],
      ["br", iconCx + iconWidth / 2, iconCy - iconHeight / 2],
      ["bl", iconCx - iconWidth / 2, iconCy - iconHeight / 2],
    ];
    for (const [corner, lx, ly] of corners) {
      // Unit square scaled to a screen-constant pixel size by `rescale()`.
      const handle = new Graphics();
      handle.rect(-0.5, -0.5, 1, 1).fill(HANDLE_FILL);
      handle.position.set(lx, ly);
      handle.zIndex = HANDLE_Z_INDEX;
      handle.visible = false;
      handle.eventMode = "static";
      handle.hitArea = new Rectangle(-0.5, -0.5, 1, 1);
      tagEntity(handle, "handle", corner);
      this.parent.addChild(handle);
      this.handles.push(handle);
    }
  }

  setVisible(visible: boolean): void {
    this.currentVisible = visible;
    for (const h of this.handles) {
      h.visible = visible;
    }
    if (visible) {
      this.rescale();
    }
    this.ctx.requestRender();
  }

  isVisible(): boolean {
    return this.currentVisible;
  }

  dispose(): void {
    for (const h of this.handles) {
      h.destroy();
    }
    this.handles.length = 0;
  }

  /**
   * Resize handles to a constant screen-pixel size. Call after any change
   * that affects the world-per-pixel ratio — zoom or canvas resize. No-op
   * while invisible.
   */
  rescale(): void {
    if (!this.currentVisible) {
      return;
    }
    const size = this.handlePixelSize * this.ctx.worldPerPixel();
    const s = worldScaleXY(this.parent);
    for (const h of this.handles) {
      h.scale.set(size / s.x, size / s.y);
    }
  }
}

/**
 * Gap between a shape's top edge and the rotate disc's centre, as a
 * fraction of the icon height. Icon-relative (not screen-pixel) so the
 * disc tracks the component as it scales with zoom — matching how the
 * corner resize handles stay glued to the icon's corners.
 */
const ROTATE_HANDLE_GAP_FRACTION = 0.2;

/**
 * Single rotate affordance for a shape node: a pickable disc floating just
 * above the shape's top edge. It carries a `rotate-handle` identity tag so
 * the picker walks up to the owning shape; picking it starts a rotate-drag
 * gesture. Sized in screen pixels (kept constant by `rescale()`), but its
 * gap above the edge is icon-relative so it scales with the component.
 */
export class RotateHandle {
  private readonly handle: Graphics;
  private currentVisible = false;

  // Signature mirrors ResizeHandles / SelectionOutline so OmShapeNode
  // constructs all three identically; the single top-centre handle
  // doesn't need the width.
  constructor(
    private readonly ctx: SceneContext,
    private readonly parent: Container,
    _iconWidth: number,
    iconHeight: number,
    iconCx: number,
    iconCy: number,
    private readonly handlePixelSize: number = 10,
  ) {
    const topEdgeY = iconCy + iconHeight / 2;
    const gapLocal = iconHeight * ROTATE_HANDLE_GAP_FRACTION;

    this.handle = new Graphics();
    this.handle.circle(0, 0, 0.5).fill(SELECTION_BLUE);
    this.handle.position.set(iconCx, topEdgeY + gapLocal);
    this.handle.zIndex = HANDLE_Z_INDEX;
    this.handle.visible = false;
    this.handle.eventMode = "static";
    this.handle.hitArea = new Circle(0, 0, 0.5);
    // nodeId is inert — `entityKeyForNode` resolves the owning shape by
    // walking the parent chain, so any value works.
    tagEntity(this.handle, "rotate-handle", "rotate");
    this.parent.addChild(this.handle);
  }

  setVisible(visible: boolean): void {
    this.currentVisible = visible;
    this.handle.visible = visible;
    if (visible) {
      this.rescale();
    }
    this.ctx.requestRender();
  }

  isVisible(): boolean {
    return this.currentVisible;
  }

  dispose(): void {
    this.handle.destroy();
  }

  /**
   * Size the disc to a constant screen-pixel diameter. The gap above the
   * edge is icon-relative and fixed at construction, so only the diameter
   * tracks zoom. No-op while invisible.
   */
  rescale(): void {
    if (!this.currentVisible) {
      return;
    }
    const size = this.handlePixelSize * this.ctx.worldPerPixel();
    const s = worldScaleXY(this.parent);
    this.handle.scale.set(size / s.x, size / s.y);
  }
}

/**
 * Per-vertex drag handles for a poly (line / polygon) shape. One small
 * pickable disc sits on each vertex; picking one starts a vertex-drag
 * gesture. Each carries a `vertex-handle` tag with a self-describing
 * `nodeId` of `${ownerId}/${vertexIndex}` (e.g. `line:1/2`). Positions are
 * the shape's own `points` — valid only because a poly host shape uses an
 * identity diagram frame (the parent sits at the shape origin, unscaled),
 * so a point coordinate is already the handle's local position.
 */
export class VertexHandles {
  private readonly handles: Graphics[] = [];
  private currentVisible = false;

  constructor(
    private readonly ctx: SceneContext,
    parent: Container,
    points: ReadonlyArray<Point>,
    ownerId: string,
  ) {
    points.forEach(([x, y], i) => {
      // Diagram-unit disc matching the connection junction — a grab target
      // that scales with zoom (the entity's poly frame is unscaled).
      const handle = new Graphics();
      handle.circle(0, 0, VERTEX_DOT_RADIUS).fill(VERTEX_DOT_COLOR);
      handle.position.set(x, y);
      handle.zIndex = HANDLE_Z_INDEX;
      handle.visible = false;
      handle.eventMode = "static";
      handle.hitArea = new Circle(0, 0, VERTEX_DOT_RADIUS);
      tagEntity(
        handle,
        "vertex-handle" satisfies EntityKind,
        `${ownerId}/${i}`,
      );
      parent.addChild(handle);
      this.handles.push(handle);
    });
  }

  setVisible(visible: boolean): void {
    this.currentVisible = visible;
    for (const h of this.handles) {
      h.visible = visible;
    }
    this.ctx.requestRender();
  }

  isVisible(): boolean {
    return this.currentVisible;
  }

  dispose(): void {
    for (const h of this.handles) {
      h.destroy();
    }
    this.handles.length = 0;
  }

  /** No-op: the dots are diagram-sized, so they track zoom on their own. */
  rescale(): void {}
}
