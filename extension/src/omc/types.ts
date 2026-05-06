/**
 * Domain types returned by OMC API methods.
 *
 * These mirror the records OMC produces over its ZeroMQ interactive API.
 * Field order matches OMC's tuple responses where applicable.
 */

/** 22-field tuple returned by getClassInformation(). */
export interface ClassInformation {
  /** "model", "block", "package", "function", "connector", ... */
  restriction: string;
  /** Class description string. */
  comment: string;
  partialPrefix: boolean;
  finalPrefix: boolean;
  encapsulatedPrefix: boolean;
  fileName: string;
  fileReadOnly: boolean;
  lineStart: number;
  columnStart: number;
  lineEnd: number;
  columnEnd: number;
  /** Type-dimension list (rare for non-types). */
  dimensions: string[];
  isProtectedClass: boolean;
  isDocumentationClass: boolean;
  version: string;
  /** "info", "diagram", "icon", "text". */
  preferredView: string;
  isState: boolean;
  access: string;
  versionDate: string;
  versionBuild: string;
  dateModified: string;
  revisionId: string;
}

/** One row of getComponents(). */
export interface ComponentInfo {
  className: string;
  name: string;
  comment: string;
  /** "public" | "protected". */
  protection: string;
  isFinal: boolean;
  isFlow: boolean;
  isStream: boolean;
  isReplaceable: boolean;
  /** "constant" | "parameter" | "discrete" | "". */
  variability: string;
  /** "inner" | "outer" | "" | both. */
  innerOuter: string;
  /** "input" | "output" | "". */
  causality: string;
  dimensions: string[];
}

/** One connect() statement, returned by getNthConnection(). */
export interface Connection {
  from: string;
  to: string;
  comment: string;
}

/** 5-tuple from getSimulationOptions(). */
export interface SimulationOptions {
  startTime: number;
  stopTime: number;
  tolerance: number;
  numberOfIntervals: number;
  stepSize: number;
}

/**
 * Best-effort surfacing of OMC's simulate() return record.
 *
 * OMC's response format for simulate() varies across versions. For now we
 * surface the raw text and let callers re-parse if they need specific fields.
 */
export interface SimulationResult {
  /** Path to the .mat result file (when extractable from the response). */
  resultFile: string;
  /** Concatenated messages / raw response text. */
  messages: string;
}

/** (libraryName, version) pair returned by getUses(). */
export type LibraryUse = [name: string, version: string];
