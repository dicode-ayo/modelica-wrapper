/**
 * The curated tool set, tracking OMEdit's 39 built-in MCP tools.
 *
 * Publishing all 202 registry functions is mechanically trivial and wrong:
 * measured as `{name, description, inputSchema}`, the whole registry is ~31.6k
 * tokens of static schema riding along with every request before the model has
 * read a line of Modelica. The curated set is ~4.8k, and it is the only option
 * with an external reference to check completeness against.
 *
 * Each name below is the wrapper OMEdit's own tool maps onto, taken from the
 * mapping table in #576. Six of OMEdit's tools drive its GUI rather than OMC
 * (`activeModel`, `classDiagram`, `iconDiagram`, `showPlot`, `plot`,
 * `resetEnvironment`) and two want wrappers this package does not ship yet
 * (`getTotalModel`, `resimulate`); none of them is here.
 *
 * `writeClassGraphics` is absent deliberately. It covers seven OMEdit tools on
 * its own and costs 42% of the whole set — more than the other 29 together —
 * because every caller pays for every shape's fields. `shape-tools.ts` splits
 * it the way OMEdit already had it split.
 *
 * The `readOnlyHint` each tool publishes is derived from the same table
 * invalidation reads, so the hint cannot claim a call is read-only that the
 * refresh treats as a mutation.
 */

import {
  REGISTRY,
  isReadOnlyFunction,
  type OmcFnName,
} from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dispatch, type McpToolDeps } from "./dispatch.js";

export const PARITY_TOOLS: readonly OmcFnName[] = [
  // Browsing and source
  "getClassNames",
  "listFile",
  "checkModel",
  // Lifecycle
  "loadString",
  "loadFile",
  "loadModel",
  "newModel",
  // Simulation and results
  "simulate",
  "buildModel",
  "readSimulationResultVars",
  "val",
  // Components
  "addComponent",
  "updateComponent",
  "deleteComponent",
  "getElements",
  "getElementAnnotation",
  "getModelInstance",
  // Connections
  "addConnection",
  "deleteConnection",
  "updateConnection",
  "getConnectionList",
  "getConnectorCount",
  "getNthConnector",
  // Parameters and modifiers
  "setElementModifierValue",
  "getElementModifierValues",
  "getInstantiatedParametersAndValues",
  // Annotations
  "addClassAnnotation",
  "getIconAnnotation",
  "getDiagramAnnotation",
];

/**
 * Register one MCP tool per parity wrapper, handing the registry's own zod
 * input schema straight to the SDK — it does the JSON Schema conversion itself.
 *
 * No `outputSchema` is registered. The SDK converts zod on its own and would
 * throw on the `.transform()` that every `ModelInstance` output reaches; the
 * tagging that keeps `help.ts` projecting cleanly does not sit on this path.
 */
export function registerParityTools(
  server: McpServer,
  deps: McpToolDeps,
): void {
  for (const fn of PARITY_TOOLS) {
    const entry = REGISTRY[fn];
    server.registerTool(
      fn,
      {
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: { readOnlyHint: isReadOnlyFunction(fn) },
      },
      async (input: unknown) => dispatch(deps, fn, input),
    );
  }
}
