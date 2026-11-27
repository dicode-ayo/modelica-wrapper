/**
 * The stdio host, driven over the SDK's real stdio transport on in-memory
 * streams: each request is a newline-delimited JSON-RPC frame written to the
 * host's input, each answer one read off its output.
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliSignals } from "./cli-run.js";
import { buildMcpServer } from "./mcp-server.js";
import {
  createStdioHost,
  fsSourceWriter,
  streamLog,
  type McpStdioHost,
  type OwnedMcpClient,
} from "./stdio-host.js";

const LIBRARY_ROOT = "/opt/omlibrary";

interface FakeClient extends OwnedMcpClient {
  closes: number;
  cds: string[];
}

function fakeClient(over: { closeFails?: boolean } = {}): FakeClient {
  const self = {
    closes: 0,
    cds: [] as string[],
    invoke: async () => ({ classNames: ["Demo"] }),
    getClassInformation: async () => ({
      fileReadOnly: false,
      fileName: `${LIBRARY_ROOT}/Lib/package.mo`,
      restriction: "package",
    }),
    getSourceFile: async () => ({ fileName: `${LIBRARY_ROOT}/Lib/package.mo` }),
    getModelicaPath: async () => ({ modelicaPath: LIBRARY_ROOT }),
    getErrorString: async () => ({ errorString: "" }),
    existClass: async () => ({ exists: true }),
    cd: async ({ newWorkingDirectory }: { newWorkingDirectory: string }) => {
      self.cds.push(newWorkingDirectory);
      return { workingDirectory: newWorkingDirectory };
    },
    close: async () => {
      self.closes += 1;
      if (over.closeFails === true) throw new Error("socket already gone");
    },
  };
  return self as unknown as FakeClient;
}

interface Frame {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

/** The host's two streams, with stdout split into frames as they arrive. */
function pipes(): {
  input: PassThrough;
  output: PassThrough;
  raw: () => string;
  request: (id: number, method: string, params?: unknown) => Promise<Frame>;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const waiting = new Map<number, (frame: Frame) => void>();
  let raw = "";
  let pending = "";
  output.on("data", (chunk: Buffer) => {
    raw += chunk.toString("utf8");
    pending += chunk.toString("utf8");
    for (
      let end = pending.indexOf("\n");
      end >= 0;
      end = pending.indexOf("\n")
    ) {
      const frame = JSON.parse(pending.slice(0, end)) as Frame;
      pending = pending.slice(end + 1);
      if (frame.id !== undefined) waiting.get(frame.id)?.(frame);
    }
  });
  return {
    input,
    output,
    raw: () => raw,
    request: (id, method, params) =>
      new Promise((resolve) => {
        waiting.set(id, resolve);
        input.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      }),
  };
}

const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
};

async function initialize(io: ReturnType<typeof pipes>): Promise<Frame> {
  const answer = await io.request(1, "initialize", INITIALIZE);
  io.input.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  return answer;
}

function recordingLog(): {
  warn: (m: string) => void;
  info: (m: string) => void;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    warn: (m) => lines.push(`warn ${m}`),
    info: (m) => lines.push(`info ${m}`),
  };
}

let host: McpStdioHost | undefined;
let root = "";

afterEach(async () => {
  await host?.close();
  host = undefined;
});

async function serve(
  spawn: () => Promise<OwnedMcpClient>,
  log = recordingLog(),
): Promise<{
  io: ReturnType<typeof pipes>;
  spawns: () => number;
  log: typeof log;
}> {
  root = await mkdtemp(join(tmpdir(), "mcp-stdio-"));
  const io = pipes();
  let spawns = 0;
  host = createStdioHost({
    spawn: () => {
      spawns += 1;
      return spawn();
    },
    root,
    version: "9.8.7",
    log,
    input: io.input,
    output: io.output,
  });
  await host.start();
  return { io, spawns: () => spawns, log };
}

/** The tool names the server the HTTP host builds per session lists. */
async function referenceToolNames(): Promise<string[]> {
  const server = buildMcpServer(
    {
      ensureClient: () => Promise.reject(new Error("unused")),
      verdicts: { forClass: async () => ({ ok: true }) },
    },
    "0",
  );
  const client = new Client({ name: "ref", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

function callGetClassNames(
  io: ReturnType<typeof pipes>,
  id: number,
): Promise<Frame> {
  return io.request(id, "tools/call", {
    name: "getClassNames",
    arguments: { typeName: "Demo" },
  });
}

describe("the stdio host", () => {
  it("lists the HTTP host's tool set without spawning OMC", async () => {
    const { io, spawns } = await serve(async () => fakeClient());

    const initialized = await initialize(io);
    const listed = await io.request(2, "tools/list");

    expect(initialized.result).toMatchObject({
      serverInfo: { name: "modelica-omc", version: "9.8.7" },
    });
    const tools = listed.result?.tools as { name: string }[];
    expect(tools.map((tool) => tool.name)).toEqual(await referenceToolNames());
    expect(tools.length).toBeGreaterThan(0);
    expect(spawns()).toBe(0);
  });

  it("spawns OMC once, parked under the root, and closes it on input end", async () => {
    const client = fakeClient();
    const { io, spawns } = await serve(async () => client);
    await initialize(io);

    await callGetClassNames(io, 2);
    await callGetClassNames(io, 3);
    io.input.end();
    await host?.closed;

    expect(spawns()).toBe(1);
    expect(client.cds).toEqual([join(root, ".modelica")]);
    expect(client.closes).toBe(1);
  });

  it("shuts down without spawning OMC when no tool was called", async () => {
    const { io, spawns } = await serve(async () => fakeClient());
    await initialize(io);

    io.input.end();
    await host?.closed;

    expect(spawns()).toBe(0);
  });

  it("closes a client whose spawn was still in flight at shutdown", async () => {
    const client = fakeClient();
    let release = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { io } = await serve(async () => {
      await ready;
      return client;
    });
    await initialize(io);

    void callGetClassNames(io, 2);
    await new Promise((resolve) => setImmediate(resolve));
    const closing = host?.close();
    release();
    await closing;

    expect(client.closes).toBe(1);
  });

  it("finishes shutting down when a spawn in flight at shutdown fails", async () => {
    let fail = (): void => undefined;
    const { io } = await serve(
      () =>
        new Promise<OwnedMcpClient>((_resolve, reject) => {
          fail = () => reject(new Error("spawn omc ENOENT"));
        }),
    );
    await initialize(io);

    void callGetClassNames(io, 2);
    await new Promise((resolve) => setImmediate(resolve));
    const closing = host?.close();
    fail();

    await expect(closing).resolves.toBeUndefined();
  });

  it("spawns nothing for a call that arrives as shutdown begins", async () => {
    const { io, spawns } = await serve(async () => fakeClient());
    await initialize(io);
    // Runs after the transport's own listener has handed the frame to the
    // server, and before the server's handler does, which is a microtask.
    io.input.once("data", () => {
      void host?.close();
    });

    io.input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "getClassNames", arguments: { typeName: "Demo" } },
      })}\n`,
    );
    await host?.closed;
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawns()).toBe(0);
  });

  it("spawns again after a spawn failed, and reports the failure to the caller", async () => {
    let fail = true;
    const { io, spawns, log } = await serve(async () => {
      if (fail) throw new Error("spawn omc ENOENT");
      return fakeClient();
    });
    await initialize(io);

    const failed = await callGetClassNames(io, 2);
    fail = false;
    const served = await callGetClassNames(io, 3);

    expect(failed.result).toMatchObject({ isError: true });
    expect(JSON.stringify(failed.result)).toContain("spawn omc ENOENT");
    expect(served.result?.isError).toBeUndefined();
    expect(spawns()).toBe(2);
    expect(log.lines.some((line) => line.includes("ENOENT"))).toBe(true);
  });

  it("refuses a write into a class under MODELICAPATH", async () => {
    const { io } = await serve(async () => fakeClient());
    await initialize(io);

    const answer = await io.request(2, "tools/call", {
      name: "addComponent",
      arguments: {
        componentName: "r1",
        componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
        intoTypeName: "Lib",
      },
    });

    expect(answer.result).toMatchObject({ isError: true });
    expect(JSON.stringify(answer.result)).toContain(
      "Cannot edit Lib — it belongs to a read-only system library.",
    );
  });

  it("logs a failed OMC shutdown instead of throwing it", async () => {
    const { io, log } = await serve(async () =>
      fakeClient({ closeFails: true }),
    );
    await initialize(io);
    await callGetClassNames(io, 2);

    await host?.close();

    expect(log.lines).toContain("warn closing OMC failed: socket already gone");
  });

  it("logs a malformed frame and keeps serving", async () => {
    const { io, log } = await serve(async () => fakeClient());
    await initialize(io);

    io.input.write("not json\n");
    const listed = await io.request(2, "tools/list");

    expect(
      log.lines.some((line) => line.startsWith("warn transport error")),
    ).toBe(true);
    expect(listed.result?.tools).toBeDefined();
  });
});

describe("the source writer", () => {
  it("creates the directories a new file needs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-writer-"));
    const file = join(dir, "Pkg", "Sub", "Model.mo");

    await fsSourceWriter.write(file, "model Model end Model;\n");

    expect(await readFile(file, "utf8")).toBe("model Model end Model;\n");
  });
});

/** Signals the test raises by hand. */
function fakeSignals(): CliSignals & {
  raise: (s: "SIGINT" | "SIGTERM") => void;
} {
  const listeners = new Map<string, () => void>();
  return {
    once: (event, listener) => listeners.set(event, listener),
    raise: (signal) => listeners.get(signal)?.(),
  };
}

function cliStreams(): {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  text: (s: PassThrough) => string;
} {
  const chunks = new Map<PassThrough, string>();
  const capture = (s: PassThrough): PassThrough => {
    chunks.set(s, "");
    s.on("data", (c: Buffer) =>
      chunks.set(s, `${chunks.get(s) ?? ""}${c.toString("utf8")}`),
    );
    return s;
  };
  return {
    stdin: new PassThrough(),
    stdout: capture(new PassThrough()),
    stderr: capture(new PassThrough()),
    text: (s) => chunks.get(s) ?? "",
  };
}

describe("the modelica-mcp CLI", () => {
  it("prints usage on --help and exits 0 without serving", async () => {
    const streams = cliStreams();

    const code = await runCli({
      ...streams,
      argv: ["--help"],
      cwd: "/work",
      signals: fakeSignals(),
      spawn: async () => fakeClient(),
      version: "0",
    });

    expect(code).toBe(0);
    expect(streams.text(streams.stdout)).toContain("Usage: modelica-mcp");
  });

  it("exits 2 on an unknown argument, writing to stderr only", async () => {
    const streams = cliStreams();

    const code = await runCli({
      ...streams,
      argv: ["--http"],
      cwd: "/work",
      signals: fakeSignals(),
      spawn: async () => fakeClient(),
      version: "0",
    });

    expect(code).toBe(2);
    expect(streams.text(streams.stdout)).toBe("");
    expect(streams.text(streams.stderr)).toContain("--http");
  });

  it("keeps stdout to protocol frames while logging to stderr, and stops on SIGTERM", async () => {
    const streams = cliStreams();
    const signals = fakeSignals();
    const client = fakeClient();
    const dir = await mkdtemp(join(tmpdir(), "mcp-cli-"));

    const running = runCli({
      ...streams,
      argv: ["--root", dir],
      cwd: "/work",
      signals,
      spawn: async () => client,
      version: "0",
    });
    const answered = new Promise<void>((resolve) => {
      streams.stdout.on("data", (c: Buffer) => {
        if (c.toString("utf8").includes('"id":2')) resolve();
      });
    });
    streams.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE })}\n`,
    );
    streams.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "getClassNames", arguments: { typeName: "Demo" } },
      })}\n`,
    );
    await answered;
    signals.raise("SIGTERM");

    expect(await running).toBe(0);
    const frames = streams.text(streams.stdout).trim().split("\n");
    for (const frame of frames) {
      expect(JSON.parse(frame)).toMatchObject({ jsonrpc: "2.0" });
    }
    const logged = streams.text(streams.stderr);
    expect(logged).toContain(`[info] serving over stdio; source tree ${dir}`);
    expect(logged).toContain("[info] SIGTERM: shutting down");
    expect(client.closes).toBe(1);
  });
});

describe("streamLog", () => {
  it("writes one tagged line per message", () => {
    const stream = new PassThrough();
    const log = streamLog(stream);

    log.warn("a");
    log.info("b");

    expect(String(stream.read())).toBe("[warn] a\n[info] b\n");
  });
});
