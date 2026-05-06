/**
 * OMC client public surface.
 *
 * Top-level: `OmcClient.create()` to spawn OMC and connect.
 * Lower-level pieces (parser, types) are also exported for tests and tools.
 */

export { OmcClient, type OmcClientOptions } from "./client.js";
export type {
  ClassInformation,
  ComponentInfo,
  Connection,
  LibraryUse,
  SimulationOptions,
  SimulationResult,
} from "./types.js";
export {
  parse,
  toJson,
  isNull,
  asString,
  asBool,
  asInt,
  asFloat,
  asList,
  asStringList,
  expectString,
  expectBool,
  expectInt,
  expectFloat,
  expectList,
  expectStringList,
  type Value,
  type Json,
} from "./parse.js";
