import type { IconLayer } from "@dicode/omc-client";
import { hasDrawnShapes } from "@dicode/omc-client/shapes";

/**
 * Stand-in visual for a catalog class whose `Icon` AND `Diagram`
 * annotations draw nothing: a dashed outline plus the instance name.
 * Without it such a class renders as nothing while staying hit-testable
 * (the port disc / hit geometry is built unconditionally).
 *
 * Substituted at render time from the class catalog (`layout.classes[...]`)
 * only — never into a host class's own layer sets; `iconContextLayers` in
 * the producer states why.
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

/** `layers`, or the NoIcon placeholder when nothing in them draws. */
export function withNoIconFallback(layers: IconLayer[]): IconLayer[] {
  return hasDrawnShapes(layers) ? layers : NO_ICON_LAYERS;
}
