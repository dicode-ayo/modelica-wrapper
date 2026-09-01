/**
 * The capabilities `omc-bootstrap` needs, in plain Node.
 *
 * `installManagedOmc` injects its filesystem, network and subprocess access;
 * these are the implementations bound to this host. Nothing here imports
 * `vscode`.
 */

import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import type { Readable } from "node:stream";
import * as net from "node:net";
import * as path from "node:path";
import * as tls from "node:tls";

import {
  installManagedOmc,
  removeManagedOmc,
  type DownloadRequest,
  type InstallFileSystem,
  type InstallOmcInput,
  type InstallOmcResult,
  type ProcessRequest,
  type ProcessResult,
  type RemoveOmcInput,
  type ReportProgress,
} from "@dicode/omc-bootstrap";

import { pathExists } from "./fs-util.js";

/** Progress and cancellation, which only the editor can supply. */
export interface InstallHooks {
  readonly report: ReportProgress;
  readonly signal: AbortSignal;
}

/** The managed installation's two operations, with this host's capabilities bound in. */
export interface OmcInstaller {
  install(
    input: InstallOmcInput,
    hooks: InstallHooks,
  ): Promise<InstallOmcResult>;
  remove(input: RemoveOmcInput): Promise<boolean>;
}

export function nodeInstaller(): OmcInstaller {
  const fs = nodeInstallFileSystem();
  return {
    install: (input, hooks) =>
      installManagedOmc(input, {
        fs,
        download: downloadFile,
        run: runProcess,
        report: hooks.report,
        signal: hooks.signal,
      }),
    remove: (input) => removeManagedOmc(input, fs),
  };
}

function nodeInstallFileSystem(): InstallFileSystem {
  return {
    exists: pathExists,
    availableBytes: async (target) => {
      // The space check runs before anything is created, so the answer has to
      // come from whichever ancestor does exist.
      const stats = await fsp.statfs(await nearestExisting(target));
      return stats.bavail * stats.bsize;
    },
    makeDirectory: async (target) => {
      await fsp.mkdir(target, { recursive: true });
    },
    writeFile: (target, contents) => fsp.writeFile(target, contents),
    makeExecutable: (target) => fsp.chmod(target, 0o755),
    move: (from, to) => fsp.rename(from, to),
    remove: (target) => fsp.rm(target, { recursive: true, force: true }),
  };
}

async function nearestExisting(target: string): Promise<string> {
  let at = target;
  for (;;) {
    if (await pathExists(at)) return at;
    const up = path.dirname(at);
    if (up === at) return at;
    at = up;
  }
}

function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, [...request.args], {
      // Merged over the parent environment: micromamba and the `omc` it
      // installs both need the ambient PATH, HOME and temp directory.
      env: { ...process.env, ...request.env },
      signal: request.signal,
    });
    let stdout = "";
    let stderr = "";
    capture(child.stdout, (text) => {
      stdout += text;
      request.onOutput?.(text);
    });
    capture(child.stderr, (text) => {
      stderr += text;
      request.onOutput?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ exitCode: code ?? -1, stdout, stderr }),
    );
  });
}

/**
 * micromamba writes UTF-8 box-drawing and tick characters, and a chunk boundary
 * can fall inside one. `setEncoding` decodes across reads; decoding each chunk
 * on its own would replace the split character with U+FFFD.
 */
function capture(
  stream: Readable | null,
  onText: (text: string) => void,
): void {
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => onText(chunk));
}

const MAX_REDIRECTS = 5;

/**
 * Fetch a URL into memory, through `http.proxy` when one is set.
 *
 * Node's `fetch` cannot be pointed at a proxy, and the user this whole setting
 * exists for is the one who can reach nothing without it.
 */
export async function downloadFile(
  request: DownloadRequest,
): Promise<Uint8Array> {
  const response = await follow(new URL(request.url), request, MAX_REDIRECTS);
  const totalBytes = contentLength(response);
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of response) {
    const bytes = chunk as Buffer;
    chunks.push(bytes);
    receivedBytes += bytes.length;
    request.onProgress?.(receivedBytes, totalBytes);
  }
  return Buffer.concat(chunks);
}

async function follow(
  url: URL,
  request: DownloadRequest,
  redirectsLeft: number,
): Promise<http.IncomingMessage> {
  const response = await send(url, request);
  const status = response.statusCode ?? 0;
  const location = response.headers.location;

  if (status >= 300 && status < 400 && location !== undefined) {
    // Release the socket: a redirect body is never read.
    response.resume();
    if (redirectsLeft === 0) {
      throw new Error(
        `${request.url} redirected more than ${MAX_REDIRECTS} times.`,
      );
    }
    return follow(new URL(location, url), request, redirectsLeft - 1);
  }
  if (status !== 200) {
    response.resume();
    throw new Error(`${url.href} responded ${status}.`);
  }
  return response;
}

async function send(
  url: URL,
  request: DownloadRequest,
): Promise<http.IncomingMessage> {
  const proxy = parseProxy(request.proxy);
  const secure = url.protocol === "https:";

  // A proxy serves a plain-http URL by being asked for the absolute URL, and a
  // https one by opening a tunnel the TLS handshake then runs inside.
  if (proxy !== undefined && !secure) {
    return await respond(http, {
      host: proxy.hostname,
      port: portOf(proxy, 80),
      path: url.href,
      headers: proxyAuthorization(proxy),
      signal: request.signal,
    });
  }

  const tunnelled =
    proxy === undefined ? undefined : await tunnel(url, proxy, request.signal);

  return await respond(secure ? https : http, {
    host: url.hostname,
    port: portOf(url, secure ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    signal: request.signal,
    // `agent` stays unset: Node honours a request's `createConnection` only
    // while it has no agent, and `agent: false` mints a fresh one that would
    // open its own direct socket and leave the tunnel unused.
    ...(tunnelled === undefined
      ? {}
      : {
          createConnection: () =>
            tls.connect({ socket: tunnelled, servername: url.hostname }),
        }),
  });
}

function respond(
  transport: typeof http | typeof https,
  options: https.RequestOptions,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const outgoing = transport.request(options, resolve);
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function tunnel(
  url: URL,
  proxy: URL,
  signal: AbortSignal | undefined,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: proxy.hostname,
      port: portOf(proxy, 80),
      method: "CONNECT",
      path: `${url.hostname}:${portOf(url, 443)}`,
      headers: proxyAuthorization(proxy),
      signal,
    });
    outgoing.on("connect", (response, socket) => {
      if (response.statusCode === 200) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(
        new Error(
          `The proxy at ${proxy.host} refused a tunnel to ${url.hostname} (${response.statusCode ?? "no status"}).`,
        ),
      );
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/**
 * `http.proxy` as a URL. A value that cannot be parsed is raised rather than
 * ignored: going direct instead would hang for exactly the user who set it.
 */
function parseProxy(proxy: string | undefined): URL | undefined {
  const configured = proxy?.trim();
  if (configured === undefined || configured.length === 0) return undefined;
  try {
    return new URL(
      configured.includes("://") ? configured : `http://${configured}`,
    );
  } catch {
    throw new Error(`http.proxy is not a URL: ${configured}`);
  }
}

function proxyAuthorization(proxy: URL): Record<string, string> {
  if (proxy.username === "") return {};
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return {
    "Proxy-Authorization": `Basic ${Buffer.from(credentials).toString("base64")}`,
  };
}

function portOf(url: URL, fallback: number): number {
  return url.port === "" ? fallback : Number(url.port);
}

function contentLength(response: http.IncomingMessage): number | undefined {
  const header = response.headers["content-length"];
  if (header === undefined) return undefined;
  const total = Number(header);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}
