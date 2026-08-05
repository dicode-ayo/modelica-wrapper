/**
 * Barrel re-exports for the Diagram-Layout producer.
 *
 * Pure JSON-to-JSON transform from OMC's `ModelInstance` tree to a
 * renderer-agnostic, class-deduplicated `DiagramLayout`. No OMC contact;
 * no rendering. Validate the input with the Zod schemas in
 * `_shared/modelInstance.ts` before calling `produceDiagramLayout`.
 */
export { produceDiagramLayout, produceComponentClass } from "./producer.js";
export {
  walkExtendsChain,
  type ExtendsChainNode,
} from "../../_shared/extendsChain.js";
export { parseInstantiatedParameters } from "./resolved-parameters.js";
export {
  annotationGraphics,
  annotationCoordinateSystem,
  type CoordinateSystemFields,
} from "./annotation-layout.js";
export type {
  ClassDef,
  ComponentInstance,
  ConnectionEndpoint,
  ConnectionLayout,
  ConnectorInstance,
  CoordinateSystem,
  DiagramLayout,
  Expression,
  Extent,
  IconLayer,
  LabelLayout,
  LineShape,
  Modifier,
  ParameterDef,
  PolygonShape,
  RectangleShape,
  EllipseShape,
  TextShape,
  BitmapShape,
  Placement,
  Point,
  PortDef,
  Shape,
  SourceLocation,
} from "../../_shared/diagramLayout.js";
export { DiagramLayoutSchema } from "../../_shared/diagramLayout.js";
export { shapeToRecord } from "./shape-serialize.js";
