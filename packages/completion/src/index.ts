/**
 * Context-aware Modelica autocomplete core. Host-agnostic: the cursor's context
 * routes to the OMC source(s) that produce a list of plain-data candidates. The
 * OMC connection enters as the structural {@link CompletionClient}, and hot-path
 * tracing as an injected logger (see `@dicode/modelica-lang-core`).
 */

export { computeCompletions } from "./compute.js";
export {
  CompletionCandidateKind,
  MAX_COMPLETIONS,
  MIN_FUZZY_PREFIX,
  type CompletionCandidate,
  type CompletionResult,
} from "./candidate.js";
export type { CompletionClient } from "./client.js";
export { ANNOTATION_ENUM_NAMES } from "./annotation-schema.js";
