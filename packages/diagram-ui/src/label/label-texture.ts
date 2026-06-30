import { Container } from "pixi.js";

import type { SceneContext } from "../scene/scene-context.js";

/**
 * Lazy per-scene screen-space overlay `Container` reused by every
 * `<om-label>`.
 *
 * Labels live outside the pan/zoom/Y-flip transform so their font size
 * stays in screen pixels across the full zoom range. The layer is a
 * top-level sibling of `worldRoot` under the stage (identity transform),
 * added after it so labels paint on top. Each `<om-label>` parents its
 * `Text` here and reprojects it per frame from its in-world anchor.
 *
 * Returns `null` when built renderer-less (headless tests): Pixi measures
 * `Text` glyphs through a 2D canvas, so a label skips its `Text` and falls
 * back to the `currentText` getter. The layer rides stage destruction —
 * `stage.destroy({ children: true })` tears it down with no extra hook.
 */
const layers = new WeakMap<Container, Container>();

export function ensureLabelLayer(ctx: SceneContext): Container | null {
  if (ctx.renderer === null) {
    return null;
  }
  const stage = ctx.stage;
  const existing = layers.get(stage);
  if (existing && !existing.destroyed) {
    return existing;
  }
  const layer = new Container({ label: "om-label-layer" });
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  stage.addChild(layer);
  layers.set(stage, layer);
  return layer;
}
