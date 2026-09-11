/**
 * @dicode/modelica-mcp — the MCP tool surface over the OpenModelica scripting
 * API, with no editor dependency.
 *
 * A host supplies three things: a way to reach OMC, a source of write verdicts,
 * and somewhere to log. What it gets back is a loopback HTTP server carrying
 * the curated OMEdit-parity tool set. The VSCode extension is one such host and
 * hands it the `OmcClient` its window already owns, which is the reason the
 * server runs in-process rather than as a child: OMC is a per-window singleton,
 * and a second one would give an assistant its own invisible AST.
 */

export {
  dispatch,
  dispatchByName,
  errorResult,
  textResult,
  type McpToolClient,
  type McpToolDeps,
} from "./dispatch.js";

export {
  createMcpHttpHost,
  type McpEndpoint,
  type McpHttpHost,
} from "./http-host.js";

export { buildMcpServer } from "./mcp-server.js";

export { PARITY_TOOLS } from "./parity-tools.js";

export { refusalFor } from "./write-gate.js";

export type { McpLog } from "./log.js";

export type {
  WriteAction,
  WriteVerdict,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";
