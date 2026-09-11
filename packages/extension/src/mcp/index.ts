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
 * A client VSCode does not configure reaches the same server through
 * `client-config.ts`, which hands its address over by hand.
 */

import * as vscode from "vscode";

import { createMcpHttpHost, type McpToolDeps } from "@dicode/modelica-mcp";

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

export function registerMcpServerProvider(
  deps: McpToolDeps,
  version: string,
): vscode.Disposable {
  const host = createMcpHttpHost({
    deps,
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
