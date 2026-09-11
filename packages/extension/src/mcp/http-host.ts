/**
 * The loopback HTTP server the MCP client talks to, inside the extension host.
 *
 * HTTP rather than stdio, and the reason is the OMC singleton. `OmcClientCache`
 * holds one `OmcClient` per window and coalesces every caller onto it; a stdio
 * server is a separate process that would have to spawn its own `omc`, so a
 * class an assistant loaded would be invisible to the sidebar, the diagram and
 * the diagnostics pipeline. That is the split-brain `OmcClientCache` exists to
 * prevent, reintroduced across a process boundary its coalescing cannot reach.
 * VSCode's own MCP HTTP client runs in this same extension host, so loopback
 * reaches it with no CORS and no IPC.
 *
 * The port is ephemeral, so two windows cannot collide on it.
 *
 * Two things guard the port, which any local process can reach:
 *
 *  - a bearer token minted per listen and handed to VSCode in the definition's
 *    headers, so a request without it is refused before the SDK sees it;
 *  - a loopback check on the peer address, so nothing off-machine is answered
 *    even if the bind ever widens.
 */

import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isIPv4 } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";
import { buildMcpServer } from "./mcp-server.js";
import type { McpToolDeps } from "./dispatch.js";

const LOOPBACK = "127.0.0.1";

/** Where the server listens, and what a client must present to be answered. */
export interface McpEndpoint {
  readonly url: string;
  readonly token: string;
}

export interface McpHttpHost {
  /** Starts listening on first call; later calls return the same endpoint. */
  start: () => Promise<McpEndpoint>;
  dispose: () => Promise<void>;
}

interface Opened {
  readonly server: Server;
  readonly endpoint: McpEndpoint;
}

export function createMcpHttpHost(
  deps: McpToolDeps,
  version: string,
): McpHttpHost {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  let started: Promise<Opened> | undefined;

  /**
   * One `McpServer` per session: the SDK binds a server to exactly one
   * transport. A transport that never reports a session id was rejected before
   * it adopted anything, so its server is closed here rather than left
   * reachable — and with it the tool closures and `deps` — for the life of the
   * extension host.
   */
  const openSession = async (
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> => {
    const mcp = buildMcpServer(deps, version);
    let adopted = false;
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // Passed as an option rather than assigned afterwards: the transport
        // reads it once at construction and never consults the property.
        onsessioninitialized: (id: string) => {
          adopted = true;
          sessions.set(id, transport);
        },
        onsessionclosed: (id: string) => {
          sessions.delete(id);
          void mcp.close();
        },
      });
    // `Transport` declares `onclose?: () => void` while the transport exposes
    // `(() => void) | undefined`, which `exactOptionalPropertyTypes` separates.
    await mcp.connect(transport as unknown as Transport);
    try {
      await transport.handleRequest(req, res, body);
    } finally {
      if (!adopted) await mcp.close();
    }
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
  ): Promise<void> => {
    if (
      !isLoopback(req) ||
      header(req, "authorization") !== `Bearer ${token}`
    ) {
      res.writeHead(403).end();
      return;
    }
    // Only a POST carries one, and the transport reads the stream itself for
    // the methods that do not.
    const body =
      req.method === "POST" ? await readJsonBody(req) : { value: undefined };
    if (body === undefined) {
      res.writeHead(400).end();
      return;
    }

    const sessionId = header(req, "mcp-session-id");
    const session =
      sessionId === undefined ? undefined : sessions.get(sessionId);
    if (session !== undefined) {
      await session.handleRequest(req, res, body.value);
      return;
    }
    // An SSE reconnect, a DELETE, or a POST whose session has already been
    // dropped would each be refused by a transport built to serve it — after a
    // whole tool set had been registered on the way.
    if (!isInitializeRequest(body.value)) {
      res.writeHead(404).end();
      return;
    }
    await openSession(req, res, body.value);
  };

  return {
    start: async () => {
      started ??= listen(handle);
      return (await started).endpoint;
    },
    dispose: async () => {
      const opening = started;
      started = undefined;
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((transport) => transport.close()));
      if (opening === undefined) return;
      // Awaited rather than read back from a second slot, so a dispose landing
      // before the listen resolves still closes the socket it opened.
      const opened = await opening.catch(() => undefined);
      if (opened === undefined) return;
      await new Promise<void>((resolve) => {
        opened.server.close(() => {
          resolve();
        });
      });
    },
  };
}

type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
) => Promise<void>;

function listen(handle: RequestHandler): Promise<Opened> {
  const token = randomUUID();
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handle(req, res, token).catch((err: unknown) => {
        log.warn("mcp", `request failed: ${errorDetail(err)}`);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.on("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the MCP server bound to no port"));
        return;
      }
      resolve({
        server,
        endpoint: { url: `http://${LOOPBACK}:${address.port}/mcp`, token },
      });
    });
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is what a dual-stack listener reports
 * for a v4 peer, so the mapping is stripped before the check.
 */
function isLoopback(req: IncomingMessage): boolean {
  const peer = req.socket.remoteAddress;
  if (peer === undefined) return false;
  const address = peer.startsWith("::ffff:")
    ? peer.slice("::ffff:".length)
    : peer;
  return isIPv4(address) ? address.startsWith("127.") : address === "::1";
}

/** The body as JSON, or `undefined` when it was not JSON at all. */
async function readJsonBody(
  req: IncomingMessage,
): Promise<{ value: unknown } | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return { value: undefined };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return undefined;
  }
}
