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
 * The port is ephemeral. OMEdit hardcodes 3000; two windows would collide.
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

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly close: () => Promise<void>;
}

export function createMcpHttpHost(
  deps: McpToolDeps,
  version: string,
): McpHttpHost {
  const sessions = new Map<string, Session>();
  let started: Promise<McpEndpoint> | undefined;
  let listening: Server | undefined;

  const openSession = async (
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> => {
    const mcp = buildMcpServer(deps, version);
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // Passed as an option rather than assigned afterwards: the transport
        // reads it once at construction and never consults the property.
        onsessioninitialized: (id: string) => {
          sessions.set(id, {
            transport,
            close: () => mcp.close(),
          });
        },
        onsessionclosed: (id: string) => {
          sessions.delete(id);
          void mcp.close();
        },
      });
    // `Transport` declares `onclose?: () => void` while the transport exposes
    // `(() => void) | undefined`, which `exactOptionalPropertyTypes` separates.
    await mcp.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, body);
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
    // Only a POST carries one, and the transport re-reads the stream itself
    // for the methods that do not.
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    if (body instanceof SyntaxError) {
      res.writeHead(400).end();
      return;
    }

    const sessionId = header(req, "mcp-session-id");
    const session =
      sessionId === undefined ? undefined : sessions.get(sessionId);
    await (session === undefined
      ? openSession(req, res, body)
      : session.transport.handleRequest(req, res, body));
  };

  return {
    start: () => {
      started ??= listen(handle).then((opened) => {
        listening = opened.server;
        return opened.endpoint;
      });
      return started;
    },
    dispose: async () => {
      started = undefined;
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((s) => s.close()));
      const server = listening;
      listening = undefined;
      if (server === undefined) return;
      await new Promise<void>((resolve) => {
        server.close(() => {
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

function listen(
  handle: RequestHandler,
): Promise<{ server: Server; endpoint: McpEndpoint }> {
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

/** The parsed body, or the `SyntaxError` that reading it produced. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return err instanceof SyntaxError ? err : new SyntaxError(errorDetail(err));
  }
}
