/**
 * Registration of the MCP server definition provider.
 *
 * The division of labor between the two provider methods is load-bearing.
 * `provideMcpServerDefinitions` is called eagerly and must not take actions
 * needing user interaction or expensive setup — so it returns a definition
 * with a placeholder URI and no headers, and starts nothing.
 * `resolveMcpServerDefinition` runs when VSCode wants the server up: that is
 * where the loopback listener comes online and where the port and bearer token
 * are filled in. `label` is `readonly` on the definition class; `uri` and
 * `headers` are not, which is what makes that split work.
 *
 * The `id` must match the manifest's `contributes.mcpServerDefinitionProviders`
 * entry — a mismatch is a hard throw from the extension host, not a warning.
 *
 * OMC is not spawned here at all. The first tool call is the earliest that may
 * happen.
 *
 * The workspace folder and the extension's self-write guard are handed down
 * because `createClass` writes files: OMC's `save` only writes to the path
 * already in its symbol table, and the guard is what keeps the `.mo` watcher
 * from reading our own write as a user's edit.
 *
 * A client VSCode does not configure reaches the same server through
 * `client-config.ts`, which hands its address over by hand.
 */

import * as vscode from "vscode";

import { createMcpHttpHost, type McpToolDeps } from "@dicode/modelica-mcp";
import type { SourceWriter } from "@dicode/omc-client";

import { log } from "../logger.js";
import { registerWriteClientConfig } from "./client-config.js";

/** Matches `contributes.mcpServerDefinitionProviders[0].id` in package.json. */
export const MCP_PROVIDER_ID = "modelica.omc";

/** Matches `contributes.mcpServerDefinitionProviders[0].label`. */
export const MCP_PROVIDER_LABEL = "Modelica (OpenModelica)";

/**
 * The definition class requires a URI, and the real one is not known until
 * `resolveMcpServerDefinition` has started the listener.
 */
const UNRESOLVED = vscode.Uri.parse("http://127.0.0.1/mcp");

/**
 * `deps` with the source tree attached, read on every access: adding or
 * removing a workspace folder does not restart the extension host, so a value
 * captured once would go stale.
 */
export function mcpToolDeps(
  deps: Omit<McpToolDeps, "workspace">,
  writer: SourceWriter,
): McpToolDeps {
  return {
    ...deps,
    get workspace() {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return root === undefined ? undefined : { root, writer };
    },
  };
}

export function registerMcpServerProvider(
  deps: Omit<McpToolDeps, "workspace">,
  writer: SourceWriter,
  version: string,
): vscode.Disposable {
  const host = createMcpHttpHost({
    deps: mcpToolDeps(deps, writer),
    version,
    log: {
      warn: (message) => {
        log.warn("mcp", message);
      },
      info: (message) => {
        log.info("mcp", message);
      },
    },
  });

  const definitions: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> =
    {
      provideMcpServerDefinitions: () => [
        new vscode.McpHttpServerDefinition(
          MCP_PROVIDER_LABEL,
          UNRESOLVED,
          {},
          version,
        ),
      ],
      resolveMcpServerDefinition: async (server) => {
        const { url, token } = await host.start();
        server.uri = vscode.Uri.parse(url);
        server.headers = { Authorization: `Bearer ${token}` };
        log.info("mcp", `serving OMC tools at ${url}`);
        return server;
      },
    };

  const provider = vscode.lm.registerMcpServerDefinitionProvider(
    MCP_PROVIDER_ID,
    definitions,
  );
  const writeConfig = registerWriteClientConfig(() => host.start());

  return new vscode.Disposable(() => {
    writeConfig.dispose();
    provider.dispose();
    void host.dispose();
  });
}
