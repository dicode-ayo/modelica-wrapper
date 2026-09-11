/**
 * The command that hands the running server's address to a client VSCode does
 * not configure.
 *
 * VSCode learns the address through `resolveMcpServerDefinition`, called
 * immediately before each start. No other client has that channel: an MCP
 * client reads a static config file, and nothing in `.mcp.json` or `mcp.json`
 * can ask this window for today's port. So the address is handed over once, by
 * the user, and goes stale when the server restarts — which the document states
 * in its first line.
 *
 * Both forms are offered because clients disagree on which they accept: Claude
 * Code takes a CLI invocation, most others take the JSON object.
 */

import * as vscode from "vscode";

import type { McpEndpoint } from "@dicode/modelica-mcp";

/** The name the snippet gives the server; clients key their config by it. */
const SERVER_KEY = "modelica";

export const COPY_CLIENT_CONFIG_COMMAND = "modelica.mcp.copyClientConfig";

/**
 * A JSONC document carrying both forms. Comments are why it is JSONC rather
 * than JSON: the staleness warning has to travel with the config, and a client
 * that strips comments still parses the object.
 */
export function clientConfigDocument(endpoint: McpEndpoint): string {
  const authorization = `Bearer ${endpoint.token}`;
  const json = JSON.stringify(
    {
      mcpServers: {
        [SERVER_KEY]: {
          type: "http",
          url: endpoint.url,
          headers: { Authorization: authorization },
        },
      },
    },
    null,
    2,
  );
  return [
    "// Modelica MCP server — this address is valid until the server restarts.",
    "// The port and token are new on every start, so re-run",
    '// "Modelica: Copy MCP Server Configuration" after a window reload.',
    "//",
    "// The token is this window's; treat it as a local secret and do not commit it.",
    "//",
    "// Claude Code:",
    `//   claude mcp add --transport http ${SERVER_KEY} ${endpoint.url} \\`,
    `//     --header "Authorization: ${authorization}"`,
    "//",
    "// Other clients — add to .mcp.json, mcp.json, or the equivalent:",
    json,
    "",
  ].join("\n");
}

/**
 * Start the server if it is not already listening, then show its address.
 *
 * Starting is the point: a client cannot be configured against a port that no
 * one has bound yet, and the user asking for the config is asking for a running
 * server.
 */
export function registerCopyClientConfig(
  start: () => Promise<McpEndpoint>,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    COPY_CLIENT_CONFIG_COMMAND,
    async () => {
      const endpoint = await start();
      const content = clientConfigDocument(endpoint);
      await vscode.env.clipboard.writeText(content);
      const document = await vscode.workspace.openTextDocument({
        content,
        language: "jsonc",
      });
      await vscode.window.showTextDocument(document, { preview: false });
      void vscode.window.showInformationMessage(
        "Modelica MCP server configuration copied to the clipboard.",
      );
    },
  );
}
