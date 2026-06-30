import { createContext } from "@lit/context";
import type { Container, Renderer } from "pixi.js";

/**
 * Lit context exposed by `<om-scene>` to its descendants.
 *
 * Children attach geometry through the separate `parentNodeContext`
 * `Container` so the scene-graph parent chain stays the single source of
 * truth for cumulative transforms. The `renderer` is here for ad-hoc
 * needs (resolution, screen size); it is `null` in headless tests that
 * build the Pixi scene graph without a GPU context.
 *
 * `diagramRoot` is the `Container` whose local coordinate space matches
 * the Modelica diagram (origin at diagram (0, 0)); its own transform maps
 * diagram units to CSS pixels. Entities attach there (directly or
 * transitively).
 */
export interface SceneContext {
  /** Pixi renderer, or `null` when built renderer-less (headless tests). */
  renderer: Renderer | null;

  /** Root container passed to `renderer.render()`. */
  stage: Container;

  /** Top-level anchor; children should not attach here directly. */
  worldRoot: Container;

  /** Root for diagram entities. Local origin = diagram (0, 0). */
  diagramRoot: Container;

  /**
   * Topmost interactive container at a stage-space point (CSS pixels
   * relative to the canvas top-left), or `null`.
   */
  pick: (x: number, y: number) => Container | null;

  /**
   * Diagram units per CSS pixel at the current zoom (= `1 / ppu`). Used
   * by screen-constant sizing — a stroke/handle that should stay N
   * pixels wide regardless of zoom uses `N * worldPerPixel()` diagram
   * units.
   */
  worldPerPixel: () => number;

  /** Schedule a coalesced on-demand repaint. No-op when `renderer` is null. */
  requestRender: () => void;
}

export const sceneContext = createContext<SceneContext | null>(
  Symbol("om-scene"),
);
