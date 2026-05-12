import { createContext } from "@lit/context";
import type { TransformNode } from "@babylonjs/core";

/**
 * Single Lit context token propagated scene → component → connector →
 * label. Each level consumes its parent's Babylon `TransformNode` and
 * provides its own. Mirrors dyad-ui's pixi `parentPixiCtx` pattern but
 * targets Babylon's scene-graph node type.
 *
 * Children always work in their parent's local coordinate space — no
 * level needs to know whether it lives directly under the scene or
 * inside a component, because the parent's TransformNode already
 * encodes the cumulative translation / rotation / scale.
 */
export const parentNodeContext = createContext<TransformNode | null>(
  Symbol("om-parent-node"),
);
