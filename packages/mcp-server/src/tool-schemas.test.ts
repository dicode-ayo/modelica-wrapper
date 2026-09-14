/**
 * What a client is handed when it lists the tools.
 *
 * The SDK converts every schema at draft-07 and takes no option to emit
 * anything else, so a construct the two drafts spell differently reaches a
 * 2020-12 client as something it refuses — and one request carries every tool,
 * so the refusal takes the whole set down rather than the tool that caused it.
 */

import { describe, expect, it } from "vitest";

import { buildMcpServer, type McpToolDeps } from "./mcp-server.js";

const deps = {
  ensureClient: async () => {
    throw new Error("no tool is called here");
  },
  verdicts: { forClass: async () => ({ ok: true as const }) },
} as unknown as McpToolDeps;

/** Every subschema reachable from `node`, itself included. */
function* subschemas(node: unknown): Generator<Record<string, unknown>> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) yield* subschemas(item);
    return;
  }
  yield node as Record<string, unknown>;
  for (const value of Object.values(node)) yield* subschemas(value);
}

describe("the published input schemas", () => {
  it("spell every array the same way in draft-07 and draft 2020-12", async () => {
    const tools = await listTools();

    const offenders = tools.flatMap(({ name, inputSchema }) =>
      [...subschemas(inputSchema)]
        .filter(
          (node) => Array.isArray(node["items"]) || "additionalItems" in node,
        )
        .map(() => name),
    );

    expect([...new Set(offenders)]).toEqual([]);
  });

  it("keeps the length bound a tuple carried", async () => {
    const tools = await listTools();
    const rectangle = tools.find((t) => t.name === "addRectangle");

    const extent = (
      rectangle?.inputSchema as { properties: Record<string, unknown> }
    ).properties["extent"];

    expect(extent).toMatchObject({
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
    });
  });
});

/** The tool definitions as the SDK serializes them for a client. */
async function listTools(): Promise<{ name: string; inputSchema: unknown }[]> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } =
    await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = buildMcpServer(deps, "1.2.3");
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  return tools;
}
