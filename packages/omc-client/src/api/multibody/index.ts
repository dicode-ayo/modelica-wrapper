/**
 * Barrel re-exports for the MultiBody visual-scene producer.
 *
 * PR 1 ships the pure data path only:
 *  - parse `<Model>_visual.xml` into a record-faithful document
 *  - resolve expression slots against an `env: Map<string, number>`
 *  - join with a `ModelInstance` to attach `componentRef` per shape
 *
 * PR 2 will add OMC orchestration (`generateVisualization`,
 * `initSolve`, `loadMultibodyScene`) under this same namespace —
 * keeping it a single import surface for downstream packages.
 */

export {
  resolveExpressions,
  produceVisualScene,
  joinWithModelInstance,
} from "../../_shared/multibodyScene.js";

export { parseVisualXml } from "../../_shared/visualXmlParser.js";

export type {
  Vec3,
  Mat3,
  Rgb,
  XmlExpr,
  XmlVec3,
  XmlMat3,
  XmlShape,
  XmlVector,
  XmlSurface,
  XmlVisualizer,
  VisualXmlDocument,
  VisualShape,
  VisualVector,
  VisualSurface,
  Visualizer,
  VisualScene,
  MultibodyScene,
  ParameterSource,
} from "../../_shared/visualScene.js";

export {
  XmlExprSchema,
  XmlShapeSchema,
  XmlVectorSchema,
  XmlSurfaceSchema,
  XmlVisualizerSchema,
  VisualXmlDocumentSchema,
  VisualShapeSchema,
  VisualVectorSchema,
  VisualSurfaceSchema,
  VisualizerSchema,
  VisualSceneSchema,
  MultibodySceneSchema,
  ParameterSourceSchema,
} from "../../_shared/visualScene.js";
