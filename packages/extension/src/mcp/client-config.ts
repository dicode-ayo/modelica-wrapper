/**
 * The command that writes the running server's address into the MCP config a
 * client reads.
 *
 * VSCode learns the address through `resolveMcpServerDefinition`, called
 * immediately before each start. No other client has that channel: an MCP
 * client reads a static config file, and nothing in `.mcp.json` or `mcp.json`
 * can ask this window for today's port. So the address is written out once, and
 * goes stale when the server restarts.
 *
 * The entry is merged rather than overwritten: `.mcp.json` is where a project's
 * other servers live, and rewriting it would take them with it. A file that
 * does not parse is left alone — a config with servers in it is worth more than
 * this one entry.
 */

import * as vscode from "vscode";

import type { McpEndpoint } from "@dicode/modelica-mcp";

import { errorDetail } from "../error-detail.js";

/** The name the entry is keyed by; clients address the server through it. */
const SERVER_KEY = "modelica";

/** Claude Code reads this at the project root, as do most other clients. */
const CONFIG_FILENAME = ".mcp.json";

export const WRITE_CLIENT_CONFIG_COMMAND = "modelica.mcp.writeClientConfig";

interface McpServerEntry {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

interface McpClientConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

function entryFor(endpoint: McpEndpoint): McpServerEntry {
  return {
    type: "http",
    url: endpoint.url,
    headers: { Authorization: `Bearer ${endpoint.token}` },
  };
}

/**
 * `existing` with this server's entry set, as text to write back.
 *
 * Returns `undefined` when `existing` is present but not an object — the file
 * belongs to something else and is not this command's to rewrite.
 */
export function mergedClientConfig(
  existing: string | undefined,
  endpoint: McpEndpoint,
): string | undefined {
  let config: McpClientConfig = {};
  if (existing !== undefined && existing.trim() !== "") {
    const parsed: unknown = JSON.parse(existing);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    config = parsed as McpClientConfig;
  }
  config.mcpServers = {
    ...config.mcpServers,
    [SERVER_KEY]: entryFor(endpoint),
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** The `claude mcp add` line, for a client configured from a terminal. */
export function claudeAddCommand(endpoint: McpEndpoint): string {
  return `claude mcp add --transport http ${SERVER_KEY} ${endpoint.url} --header "Authorization: Bearer ${endpoint.token}"`;
}

async function readIfPresent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Start the server if it is not already listening, then write its address into
 * the workspace's client config.
 *
 * Starting is the point: a client cannot be configured against a port nobody
 * has bound, and the user asking for the config is asking for a running server.
 */
export function registerWriteClientConfig(
  start: () => Promise<McpEndpoint>,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    WRITE_CLIENT_CONFIG_COMMAND,
    async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const endpoint = await start();
      // The terminal form is always available, and it is the only one a window
      // with no folder open can offer.
      await vscode.env.clipboard.writeText(claudeAddCommand(endpoint));
      if (folder === undefined) {
        void vscode.window.showInformationMessage(
          "No folder is open, so there is no .mcp.json to write. The `claude mcp add` command is on the clipboard.",
        );
        return;
      }

      const uri = vscode.Uri.joinPath(folder.uri, CONFIG_FILENAME);
      let merged;
      try {
        merged = mergedClientConfig(await readIfPresent(uri), endpoint);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `${CONFIG_FILENAME} is not valid JSON, so it was left alone: ${errorDetail(err)}`,
        );
        return;
      }
      if (merged === undefined) {
        void vscode.window.showErrorMessage(
          `${CONFIG_FILENAME} does not hold a JSON object, so it was left alone.`,
        );
        return;
      }

      await vscode.workspace.fs.writeFile(
        uri,
        new TextEncoder().encode(merged),
      );
      const open = "Open";
      const answer = await vscode.window.showInformationMessage(
        `Wrote ${SERVER_KEY} to ${CONFIG_FILENAME}. It carries this session's token — keep it out of version control, and re-run this after a reload.`,
        open,
      );
      if (answer === open) {
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(uri),
          { preview: false },
        );
      }
    },
  );
}
