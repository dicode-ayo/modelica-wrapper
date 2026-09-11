/**
 * The loopback server, exercised over real HTTP.
 *
 * code-server ships no chat client, so tool invocation through chat is not
 * e2e'd. The server answering on its port is, and it needs no client to pin.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { McpToolClient } from "./dispatch.js";
import {
  createMcpHttpHost,
  type McpEndpoint,
  type McpHttpHost,
} from "./http-host.js";

const client = {
  invoke: async () => ({ classNames: ["Demo"] }),
} as unknown as McpToolClient;

const deps = {
  ensureClient: async () => client,
  verdicts: { forClass: async () => ({ ok: true as const }) },
};

let host: McpHttpHost | undefined;

afterEach(async () => {
  await host?.dispose();
  host = undefined;
});

/** Starts a host the `afterEach` will dispose, and returns it with its port. */
async function serve(): Promise<{ host: McpHttpHost; endpoint: McpEndpoint }> {
  const started = createMcpHttpHost(deps, "1.2.3");
  host = started;
  return { host: started, endpoint: await started.start() };
}

interface Rpc {
  status: number;
  body: string;
  sessionId: string | undefined;
}

async function post(
  endpoint: McpEndpoint,
  message: unknown,
  extra: Record<string, string> = {},
): Promise<Rpc> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${endpoint.token}`,
      ...extra,
    },
    body: JSON.stringify(message),
  });
  return {
    status: response.status,
    body: await response.text(),
    sessionId: response.headers.get("mcp-session-id") ?? undefined,
  };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

describe("the loopback MCP server", () => {
  it("binds an ephemeral loopback port, never a fixed one", async () => {
    const { endpoint } = await serve();

    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(endpoint.url).not.toContain(":3000/");
  });

  it("answers the same endpoint however often it is started", async () => {
    const started = await serve();

    expect(await started.host.start()).toEqual(started.endpoint);
  });

  it("refuses a request without the token it handed VSCode", async () => {
    const { endpoint } = await serve();

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(INITIALIZE),
    });

    expect(response.status).toBe(403);
  });

  it("carries a session from initialize through to a tool call", async () => {
    const { endpoint } = await serve();

    const initialized = await post(endpoint, INITIALIZE);
    const sessionId = initialized.sessionId;
    expect(sessionId).toBeDefined();
    const session = { "mcp-session-id": sessionId ?? "" };
    await post(
      endpoint,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      session,
    );

    const listed = await post(
      endpoint,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      session,
    );
    const called = await post(
      endpoint,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "getClassNames", arguments: { typeName: "Demo" } },
      },
      session,
    );

    expect(listed.status).toBe(200);
    expect(listed.body).toContain("getClassNames");
    expect(called.status).toBe(200);
    expect(called.body).toContain("Demo");
  });

  it("rejects a body that is not JSON rather than handing it to the SDK", async () => {
    const { endpoint } = await serve();

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.token}`,
      },
      body: "{",
    });

    expect(response.status).toBe(400);
  });

  it("stops listening once disposed", async () => {
    const { host: started, endpoint } = await serve();
    await started.dispose();
    host = undefined;

    await expect(post(endpoint, INITIALIZE)).rejects.toThrow();
  });
});
