import { createContext } from "@lit/context";
import type { Container } from "pixi.js";

/**
 * Single Lit context token propagated scene → component → connector →
 * label. Each level consumes its parent's Pixi `Container` and provides
 * its own.
 *
 * Children always work in their parent's local coordinate space — no
 * level needs to know whether it lives directly under the scene or
 * inside a component, because the parent's `Container` already encodes
 * the cumulative translation / rotation / scale.
 */
export const parentNodeContext = createContext<Container | null>(
  Symbol("om-parent-node"),
);
