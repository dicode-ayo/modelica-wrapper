/**
 * MCP server contribution e2e — proves VSCode accepts
 * `contributes.mcpServerDefinitionProviders` and the extension's provider
 * surfaces a server that answers.
 *
 * `registerMcpServerDefinitionProvider` throws when its id is missing from the
 * manifest, so a wrong manifest key or id leaves the server out of
 * `MCP: List Servers`. Starting it runs `resolveMcpServerDefinition`, which
 * brings up the loopback host. `Connection state: Running` is logged before
 * any request is answered, so it proves nothing; `Discovered N tools` only
 * appears once a bearer-authenticated `tools/list` round-trip has succeeded.
 * Listing tools needs no `omc`.
 */

import { expect, test } from "../test-base.js";
import { runCommandPaletteCommand, waitForWorkbench } from "../helpers.js";

const SERVER_LABEL = "Modelica (OpenModelica)";

test.describe("MCP server contribution (OMC-free)", () => {
  test("`MCP: List Servers` lists the server, and starting it discovers tools", async ({
    page,
    codeServer,
  }) => {
    test.setTimeout(120_000);

    await page.goto(codeServer.url);
    await waitForWorkbench(page);

    const rows = page.locator(".quick-input-widget .monaco-list-row");
    const server = rows.filter({ hasText: SERVER_LABEL }).first();

    await runCommandPaletteCommand(page, "MCP: List Servers");
    await expect(server).toBeVisible();
    await server.click();
    await rows.filter({ hasText: "Start Server" }).first().click();

    // Starting the server reveals its output channel. Monaco renders spaces
    // as U+00A0, hence `\s` in the pattern.
    const output = page.locator(".part.panel .view-lines").first();
    await expect(output).toContainText(`Starting server ${SERVER_LABEL}`);
    await expect(output).toContainText(/Discovered\s[1-9]\d*\stools/);
  });
});
