import { createContext } from "@lit/context";

/**
 * Multiplier the host applies to the §18.6 default stroke width used when a
 * shape omits `lineThickness`, so one value lifts every unspecified stroke
 * (icon and host) at once. An explicit `lineThickness` is a modelling
 * decision and renders literally, unscaled. `undefined` means no lift.
 */
export const lineThicknessScaleContext = createContext<number | undefined>(
  Symbol("om-line-thickness-scale"),
);
