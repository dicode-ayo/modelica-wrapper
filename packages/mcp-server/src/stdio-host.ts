/**
 * The tool set over stdio, for a host with no editor: a CI job, a headless
 * agent, a bug reproduced from a shell.
 *
 * stdout is the protocol channel, so nothing but MCP frames may reach it; every
 * log line goes to the stream the host passes as `log`.
 *
 * This host owns its OMC. It spawns one on the first tool call — `initialize`
 * and `tools/list` need none — and closes it when the server closes. A class an
 * editor window has loaded lives in that window's OMC and is invisible here.
 *
 * Writes are gated by {@link createFsWriteVerdicts}: there is no user to ask,
 * so the gate refuses what an editor would refuse on the file system's
 * evidence alone, rather than allowing everything.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Readable, Writable } from "node:stream";

import type { SourceWriter } from "@dicode/omc-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { McpToolClient } from "./dispatch.js";
import { errorDetail } from "./error-detail.js";
import { createFsWriteVerdicts } from "./fs-verdicts.js";
import type { McpLog } from "./log.js";
import { buildMcpServer } from "./mcp-server.js";
import { parked } from "./parked.js";

/** An OMC client the host spawned and therefore shuts down. */
export interface OwnedMcpClient extends McpToolClient {
  close(): Promise<void>;
}

export interface StdioHostOptions {
  /** Called on the first tool call, and again only after a spawn failed. */
  readonly spawn: () => Promise<OwnedMcpClient>;
  /** The source tree `createClass` writes into; OMC's cwd is parked under it. */
  readonly root: string;
  /** Reported to clients; a change prompts them to refresh their tool list. */
  readonly version: string;
  readonly log: McpLog;
  readonly input: Readable;
  readonly output: Writable;
}

export interface McpStdioHost {
  start: () => Promise<void>;
  /** Idempotent; also runs when `input` ends. */
  close: () => Promise<void>;
  /** Settles once {@link close} has finished, whoever triggered it. */
  readonly closed: Promise<void>;
}

/** Writes each file `createClass` creates, making its directory as needed. */
export const fsSourceWriter: SourceWriter = {
  write: async (fsPath, text) => {
    await mkdir(dirname(fsPath), { recursive: true });
    await writeFile(fsPath, text, "utf8");
  },
};

/** One line per message, tagged with its level. */
export function streamLog(stream: Writable): McpLog {
  return {
    warn: (message) => stream.write(`[warn] ${message}\n`),
    info: (message) => stream.write(`[info] ${message}\n`),
  };
}

export function createStdioHost(options: StdioHostOptions): McpStdioHost {
  const { spawn, root, version, log, input, output } = options;
  let spawned: Promise<OwnedMcpClient> | undefined;
  let closing: Promise<void> | undefined;
  let settle: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });

  /**
   * A call racing shutdown is refused rather than served: a client spawned
   * after {@link close} has looked for one would outlive the server.
   */
  const ensureClient = (): Promise<OwnedMcpClient> => {
    if (closing !== undefined) {
      return Promise.reject(new Error("the MCP server is shutting down"));
    }
    if (spawned === undefined) {
      const attempt = spawn();
      spawned = attempt;
      attempt.catch(() => {
        if (spawned === attempt) spawned = undefined;
      });
    }
    return spawned;
  };

  const deps = parked(
    {
      ensureClient,
      verdicts: createFsWriteVerdicts(log),
      workspace: { root, writer: fsSourceWriter },
      log,
    },
    log,
  );
  const mcp = buildMcpServer(deps, version);
  mcp.server.onerror = (err) => {
    log.warn(`transport error: ${errorDetail(err)}`);
  };

  const shutDown = async (): Promise<void> => {
    input.off("end", onEnd);
    await mcp.close();
    const client = await spawned?.catch(() => undefined);
    if (client === undefined) return;
    try {
      await client.close();
    } catch (err) {
      log.warn(`closing OMC failed: ${errorDetail(err)}`);
    }
  };

  const close = (): Promise<void> => {
    closing ??= shutDown().finally(settle);
    return closing;
  };

  const onEnd = (): void => {
    void close();
  };

  return {
    start: async () => {
      input.once("end", onEnd);
      await mcp.connect(new StdioServerTransport(input, output));
    },
    close,
    closed,
  };
}
