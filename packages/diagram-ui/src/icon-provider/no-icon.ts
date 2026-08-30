import type { IconLayer } from "@dicode/omc-client";

/**
 * Stand-in visual for a catalog class whose `Icon` AND `Diagram`
 * annotations draw nothing: a dashed outline plus the instance name.
 * Without it such a class renders as nothing while staying hit-testable
 * (the port disc / hit geometry is built unconditionally).
 *
 * Expressed as `IconLayer[]` rather than an .svg asset so both renderers
 * — the Pixi shape primitives and `renderIconLayersToSvg` — consume it
 * unchanged. Substituted at render time from the class catalog
 * (`layout.classes[...]`); it must NEVER enter a host class's own
 * `DiagramLayout.iconLayers` / `diagramLayers`, which are positionally
 * addressed by `shape:<idx>` keys and diffed into source writes — a
 * synthesized shape there would shift indices and could be written into
 * user source.
 *
 * The extent matches the Modelica default coordinate system
 * (±100 × ±100), so it scales like a real icon under any placement.
 */
export const NO_ICON_LAYERS: IconLayer[] = [
  {
    // Angle brackets keep the marker out of the qualified-class-name
    // namespace; nothing keys catalog lookups off a layer's `from`.
    from: "<NoIcon>",
    shapes: [
      {
        kind: "rectangle",
        extent: [
          [-100, -100],
          [100, 100],
        ],
        lineColor: [128, 128, 128],
        pattern: "Dash",
        fillPattern: "None",
      },
      {
        kind: "text",
        extent: [
          [-96, -44],
          [96, 44],
        ],
        textString: "%name",
        textColor: [128, 128, 128],
      },
    ],
  },
];

/**
 * Whether anything in `layers` actually draws. The producer omits a layer
 * set that fails this test, but the schema still admits empty arrays —
 * layer-availability decisions must use this, not mere presence.
 */
export function hasDrawnShapes(layers: IconLayer[]): boolean {
  return layers.some((layer) => layer.shapes.length > 0);
}

/** `layers`, or the NoIcon placeholder when nothing in them draws. */
export function withNoIconFallback(layers: IconLayer[]): IconLayer[] {
  return hasDrawnShapes(layers) ? layers : NO_ICON_LAYERS;
}
