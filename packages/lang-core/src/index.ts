/**
 * Pure Modelica language core: cursor classification and OMC-backed semantic
 * resolution, host-agnostic. The OMC connection enters as a structural client
 * interface, and hot-path diagnostic tracing as an injected {@link Logger}.
 */

export * from "./cursor.js";
export * from "./resolve.js";
export { noopLogger, type Logger } from "./logger.js";
