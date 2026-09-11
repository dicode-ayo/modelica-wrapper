/**
 * @dicode/modelica-mcp — the MCP tool surface over the OpenModelica scripting
 * API, with no editor dependency.
 *
 * A host supplies a way to reach OMC, a source of write verdicts, and somewhere
 * to log. What it gets back is a loopback HTTP server carrying the curated
 * OMEdit-parity tool set. A host with a source tree supplies that too, and
 * `createClass` writes into it; without one a created class stays in OMC's
 * memory and the caller is told so.
 *
 * The VSCode extension hands it the `OmcClient` its window already owns. OMC is
 * a per-window singleton, so a host that spawned its own would give an
 * assistant an AST nothing else can see.
 */

export type { McpToolClient, McpToolDeps, McpWorkspace } from "./dispatch.js";

export {
  createMcpHttpHost,
  type McpEndpoint,
  type McpHostOptions,
  type McpHttpHost,
} from "./http-host.js";

export type { McpLog } from "./log.js";

export type {
  WriteAction,
  WriteVerdict,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";
