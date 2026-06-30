import { createContext } from "@lit/context";

/**
 * Multiplier from a shape's Modelica `lineThickness` to its on-screen stroke
 * width, provided by the host so a single value scales every stroke (icon and
 * host) at once. `undefined` falls back to the renderer default.
 */
export const lineThicknessScaleContext = createContext<number | undefined>(
  Symbol("om-line-thickness-scale"),
);
