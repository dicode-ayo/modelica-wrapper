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

import { MCP_PROVIDER_ID, MCP_PROVIDER_LABEL } from "./index.js";

interface Manifest {
  contributes: {
    mcpServerDefinitionProviders?: { id: string; label: string }[];
  };
}

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8",
  ),
) as Manifest;

describe("the MCP contribution", () => {
  it("declares the id and label the provider registers under", () => {
    expect(manifest.contributes.mcpServerDefinitionProviders).toEqual([
      { id: MCP_PROVIDER_ID, label: MCP_PROVIDER_LABEL },
    ]);
  });
});
