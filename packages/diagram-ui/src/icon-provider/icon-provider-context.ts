import { createContext } from "@lit/context";
import type { Texture } from "@babylonjs/core";
import type { CoordinateSystem, IconLayer } from "@modelica-wrapper/omc-client";

import type { IconRequest } from "./icon-cache.js";

/**
 * The icon-provider context. Children call `texture$(req)` to obtain a
 * Promise<Texture> for a given `IconLayer[]`. Internally the provider
 * deduplicates: same shapes → same texture across the scene.
 */
export interface IconProviderContext {
  textureFor(req: IconRequest): Promise<Texture>;
  /** Convenience overload — `layers` only. */
  textureForLayers(
    layers: IconLayer[],
    coordinateSystem?: CoordinateSystem,
  ): Promise<Texture>;
}

export const iconProviderContext = createContext<IconProviderContext | null>(
  Symbol("om-icon-provider"),
);
