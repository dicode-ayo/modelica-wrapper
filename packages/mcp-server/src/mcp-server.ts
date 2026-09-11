/**
 * One `McpServer` with every tool registered on it.
 *
 * Built per MCP session rather than once: the SDK binds a server to exactly one
 * transport, and the Streamable HTTP transport is per session. All of them
 * close over the same `ensureClient`, so every session drives the one OMC
 * process this window has.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerClassTools } from "./class-tools.js";
import { registerDiscoveryTools } from "./discovery-tools.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import type { McpToolDeps } from "./dispatch.js";
import { registerParityTools } from "./parity-tools.js";
import { registerShapeTools } from "./shape-tools.js";
import { registerSourceTools } from "./source-tools.js";

const MCP_SERVER_NAME = "modelica-omc";

export function buildMcpServer(deps: McpToolDeps, version: string): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerParityTools(server, deps);
  registerClassTools(server, deps);
  registerSourceTools(server, deps);
  registerShapeTools(server, deps);
  registerDiscoveryTools(server, deps);
  return server;
}
