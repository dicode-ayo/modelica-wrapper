import { createContext } from "@lit/context";
import type {
  AbstractEngine,
  ArcRotateCamera,
  Scene,
  TransformNode,
} from "@babylonjs/core";

/**
 * Lit context exposed by `<om-scene>` to its descendants.
 *
 * Children read the Babylon `Scene` for ad-hoc operations (e.g. picking
 * in an interaction manager) but should attach geometry through the
 * separate `parentNodeContext` so the scene-graph parent chain remains
 * the single source of truth for cumulative transforms.
 *
 * `diagramRoot` is the offset `TransformNode` whose local coordinate
 * space matches the Modelica diagram's coordinate system — entities
 * attach there (directly or transitively).
 */
export interface SceneContext {
  engine: AbstractEngine;
  scene: Scene;
  camera: ArcRotateCamera;

  /** Top-level pan/zoom anchor; children should not attach here directly. */
  worldRoot: TransformNode;

  /** Root for diagram entities. Local origin = diagram (0, 0). */
  diagramRoot: TransformNode;
}

export const sceneContext = createContext<SceneContext | null>(
  Symbol("om-scene"),
);
