/**
 * The curated tool set: one tool per wrapper an OMEdit MCP tool maps onto.
 *
 * Publishing the whole registry would put an order of magnitude more static
 * schema in front of the model than this set does, on every request and before
 * it has read a line of Modelica. Absent from it are OMEdit's six GUI-level
 * tools (`activeModel`, `classDiagram`, `iconDiagram`, `showPlot`, `plot`,
 * `resetEnvironment`), which are not OMC calls at all, and `getTotalModel` /
 * `resimulate`, which have no wrapper here.
 *
 * `writeClassGraphics` is absent too: on its own it costs more than the other
 * tools combined, since every caller pays for every shape's fields.
 * `shape-tools.ts` publishes it as the seven tools OMEdit spends on that job.
 *
 * `readOnlyHint` reads the same table invalidation reads, so the hint cannot
 * claim a call is read-only that the refresh treats as a mutation.
 */

import {
  REGISTRY,
  isReadOnlyFunction,
  type OmcFnName,
} from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dispatchByName, type McpToolDeps } from "./dispatch.js";

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
      async (input: unknown) => dispatchByName(deps, fn, input),
    );
  }
}
