#!/usr/bin/env node
/**
 * `modelica-mcp`: the tool set over stdio. Everything testable lives in
 * `cli-run.ts`; this binds it to the real process and the real `omc`.
 */

import { readFileSync } from "node:fs";

import { OmcClient } from "@dicode/omc-client";
import { z } from "zod";

import { runCli } from "./cli-run.js";

// `../package.json` is the package root from both `src/` and `dist/`.
const { version } = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ),
  );

// Exits rather than draining: a failed `omc` spawn leaves its port-file poll
// holding the event loop until that poll times out.
process.exit(
  await runCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    signals: process,
    spawn: OmcClient.create.bind(OmcClient),
    version,
  }),
);
