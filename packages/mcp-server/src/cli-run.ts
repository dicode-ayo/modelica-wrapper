/**
 * The standalone CLI, with the process it runs in passed as arguments so it
 * runs under test exactly as it runs from a shell.
 */

import type { Readable, Writable } from "node:stream";

import { parseCliArgs, USAGE } from "./cli-args.js";
import {
  createStdioHost,
  streamLog,
  type OwnedMcpClient,
} from "./stdio-host.js";

/** The shape of `process` the CLI subscribes its shutdown to. */
export interface CliSignals {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface CliOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly signals: CliSignals;
  readonly spawn: () => Promise<OwnedMcpClient>;
  readonly version: string;
}

/** Resolves with the exit code once the server has shut down. */
export async function runCli(options: CliOptions): Promise<number> {
  const { stdin, stdout, stderr } = options;
  const args = parseCliArgs(options.argv, options.cwd);
  if (args.kind === "help") {
    stdout.write(USAGE);
    return 0;
  }
  if (args.kind === "invalid") {
    stderr.write(`${args.message}\n\n${USAGE}`);
    return 2;
  }
  const log = streamLog(stderr);
  const host = createStdioHost({
    spawn: options.spawn,
    root: args.root,
    version: options.version,
    log,
    input: stdin,
    output: stdout,
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    options.signals.once(signal, () => {
      log.info(`${signal}: shutting down`);
      void host.close();
    });
  }
  await host.start();
  log.info(`serving over stdio; source tree ${args.root}`);
  await host.closed;
  return 0;
}
