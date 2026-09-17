/**
 * `omc_invoke`'s zod-failure rendering against a real OMC, driven through the
 * published tool surface.
 *
 * `error-detail.test.ts` pins the rendering against schemas built for the
 * test; this file proves the same rendering happens when a real OMC client
 * validates a real registry function's real input schema and throws the
 * `ZodError` `dispatchByName` actually catches. No class is loaded and no
 * library installed — every case here fails validation before OMC is ever
 * asked anything, the same way `write-gate.integration.test.ts` needs no
 * library for the cases that never reach a real OMC call either.
 *
 * Gating mirrors the other integration tests: `OMC_INTEGRATION=0` forces
 * skip, `OMC_INTEGRATION=1` forces run, otherwise `omc` on `PATH` decides.
 */

import { execSync } from "node:child_process";

import { OmcClient } from "@dicode/omc-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { McpToolClient } from "./dispatch.js";
import { buildMcpServer } from "./mcp-server.js";
import type { WriteVerdictSource } from "./write-verdict.js";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** None of this file's cases name a class, so the gate never asks. */
const verdicts: WriteVerdictSource = {
  forClass: async () => {
    throw new Error("not expected to be called: no case here names a class");
  },
};

const describeIf = shouldRun() ? describe : describe.skip;

describeIf("omc_invoke's zod rendering against live OMC", () => {
  let client: OmcClient;
  let mcp: Client;

  beforeAll(async () => {
    client = await OmcClient.create();

    const server = buildMcpServer(
      {
        ensureClient: async () => client as unknown as McpToolClient,
        verdicts,
      },
      "integration",
    );
    mcp = new Client({ name: "integration", version: "0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  }, 120_000);

  afterAll(async () => {
    await client.close();
  });

  async function invoke(fn: string, input: unknown): Promise<CallToolResult> {
    return (await mcp.callTool({
      name: "omc_invoke",
      arguments: { fn, input },
    })) as CallToolResult;
  }

  function text(result: CallToolResult): string {
    const [first] = result.content;
    if (first?.type !== "text") throw new Error("no text content");
    return first.text;
  }

  it("renders a wrong-typed argument as a sentence, not the raw issue array", async () => {
    const result = await invoke("getElements", { typeName: 42 });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "getElements.typeName: Invalid input: expected string, received number",
    );
    // The raw issue array's own bookkeeping must not leak through.
    expect(text(result)).not.toContain('"code"');
    expect(text(result)).not.toContain("invalid_type");
  });

  it("renders one line per missing required argument", async () => {
    const result = await invoke("addComponent", { componentName: "r1" });

    expect(result.isError).toBe(true);
    expect(text(result).split("\n")).toEqual([
      "addComponent.componentClass: Invalid input: expected string, received undefined",
      "addComponent.intoTypeName: Invalid input: expected string, received undefined",
    ]);
  });

  it("keeps a failed modelicaName's own message, dropping the pattern behind it", async () => {
    const result = await invoke("getElements", { typeName: "not a name)" });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "getElements.typeName: must be a Modelica name — dot-separated identifiers, " +
        'each optionally subscripted (e.g. "Modelica.Blocks.Math.Gain", "pins[3].p"), ' +
        "or a single-quoted Q-IDENT",
    );
    expect(text(result)).not.toContain("pattern");
    expect(text(result)).not.toContain("origin");
  });
});
