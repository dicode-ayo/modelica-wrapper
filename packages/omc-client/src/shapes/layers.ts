import type { IconLayer } from "../_shared/diagramLayout.js";

/**
 * Whether anything in `layers` actually draws. A layer set that fails this
 * is omitted by the producer, but the schema still admits an empty array, so
 * every layer-availability decision tests content rather than presence.
 * A shape whose `visible` is literally `false` never draws, so it does not
 * count; an absent `visible` is the spec's `true` default.
 *
 * Lives under the `shapes` subpath so browser bundles can reach it without
 * importing the package barrel, which carries Node-only code.
 */
export function hasDrawnShapes(layers: IconLayer[]): boolean {
  return layers.some((layer) =>
    layer.shapes.some((shape) => shape.visible !== false),
  );
}
