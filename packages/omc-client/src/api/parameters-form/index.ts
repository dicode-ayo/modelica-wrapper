/**
 * Barrel re-exports for the parameter-model producer.
 *
 * Pure JSON-to-JSON transform from OMC's `ModelInstance` tree to a
 * renderer-agnostic `ParameterModel`. No OMC contact; no rendering. The two
 * facts that can't be derived from the AST — the alternative-unit list and the
 * affine conversion factors — are injected as a `UnitTable` (host-fetched,
 * session-cached). Validate the input with the Zod schemas in
 * `_shared/modelInstance.ts` before calling `produceParameterModel`.
 */
export {
  produceParameterModel,
  collectBaseUnits,
  DEFAULT_DIALOG_TAB,
  DEFAULT_DIALOG_GROUP,
  type ProduceParameterModelOptions,
} from "./producer.js";
export {
  produceSimulationModel,
  SIMULATION_GROUP,
  SIMULATION_TAB,
  type ProduceSimulationModelOptions,
} from "./simulationProducer.js";
export {
  SOLVER_METHODS,
  DEFAULT_SOLVER_METHOD,
  OUTPUT_FORMATS,
  DEFAULT_OUTPUT_FORMAT,
  type SolverMethod,
  type OutputFormat,
} from "./solverMethods.js";
export { parameterModelToJsonSchema } from "./jsonSchema.js";
export type {
  ParameterModel,
  ParameterField,
  ParameterFieldKind,
  UnitOption,
  UnitTable,
} from "./types.js";
