/**
 * The loopback server, exercised over real HTTP.
 *
 * code-server ships no chat client, so tool invocation through chat is not
 * e2e'd. The server answering on its port is, and it needs no client to pin.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pathExists } from "@dicode/omc-client";
import { afterEach, describe, expect, it } from "vitest";

import type { McpToolClient } from "./dispatch.js";
import {
  createMcpHttpHost,
  type McpEndpoint,
  type McpHttpHost,
} from "./http-host.js";

const client: McpToolClient = {
  invoke: async () => ({ classNames: ["Demo"] }),
  getClassInformation: async () => ({ fileReadOnly: false }),
  getSourceFile: async () => ({ fileName: "/w/Demo.mo" }),
  getModelicaPath: async () => ({ modelicaPath: "/usr/lib/omlibrary" }),
  getErrorString: async () => ({ errorString: "" }),
};

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
async function serve(
  over: Partial<typeof deps> = {},
): Promise<{ host: McpHttpHost; endpoint: McpEndpoint }> {
  const started = createMcpHttpHost({
    deps: { ...deps, ...over },
    version: "1.2.3",
    log: { warn: () => undefined, info: () => undefined },
  });
  host = started;
  return { host: started, endpoint: await started.start() };
}

/** Initializes a session and returns the header every later post carries. */
async function openSession(
  endpoint: McpEndpoint,
): Promise<Record<string, string>> {
  const initialized = await post(endpoint, INITIALIZE);
  const session = { "mcp-session-id": initialized.sessionId ?? "" };
  await post(
    endpoint,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    session,
  );
  return session;
}

/** Any tool call will do; this one reaches `ensureClient` like the rest. */
async function callGetClassNames(
  endpoint: McpEndpoint,
  session: Record<string, string>,
): Promise<Rpc> {
  return post(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "getClassNames", arguments: { typeName: "Demo" } },
    },
    session,
  );
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

  it("parks OMC in the source tree once, not once per call", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-host-"));
    const entered: string[] = [];
    const parking: McpToolClient = {
      ...client,
      cd: async ({ newWorkingDirectory }) => {
        entered.push(newWorkingDirectory);
        return { workingDirectory: newWorkingDirectory };
      },
    };
    const { endpoint } = await serve({
      ensureClient: async () => parking,
      workspace: { root, writer: { write: async () => undefined } },
    });

    const session = await openSession(endpoint);
    await callGetClassNames(endpoint, session);
    await callGetClassNames(endpoint, session);

    expect(entered).toEqual([join(root, ".modelica")]);
    expect(await pathExists(join(root, ".modelica"))).toBe(true);
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
