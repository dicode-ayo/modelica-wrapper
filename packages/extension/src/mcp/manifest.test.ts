/**
 * The manifest contribution and the registration that claims it.
 *
 * `registerMcpServerDefinitionProvider` throws — not warns — when the id it is
 * given is absent from `contributes.mcpServerDefinitionProviders`, and nothing
 * between the constant and the manifest ties the two together.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MCP_PROVIDER_ID } from "./index.js";

interface Manifest {
  contributes: {
    mcpServerDefinitionProviders?: {
      id: string;
      label: string;
      when?: string;
    }[];
    configuration: { properties: Record<string, { default?: unknown }> };
  };
}

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8",
  ),
) as Manifest;

describe("the MCP contribution", () => {
  it("declares the id the provider registers under", () => {
    const ids = (manifest.contributes.mcpServerDefinitionProviders ?? []).map(
      (entry) => entry.id,
    );

    expect(ids).toContain(MCP_PROVIDER_ID);
  });

  it("gates the collection on a setting that is off by default", () => {
    // An ungated collection activates the extension in every window, and
    // activation calls `omcSetup.start()` — which prompts when OMC is missing.
    // The `when` clause is re-evaluated live, so flipping the setting
    // registers or disposes the collection without a window reload.
    const [entry] = manifest.contributes.mcpServerDefinitionProviders ?? [];
    const setting =
      manifest.contributes.configuration.properties["modelica.mcp.enabled"];

    expect(entry?.when).toBe("config.modelica.mcp.enabled");
    expect(setting?.default).toBe(false);
  });
});
