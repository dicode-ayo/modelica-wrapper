/**
 * Boot a code-server instance for the Playwright e2e suite and tear it down
 * surgically when the run ends.
 *
 * The harness lives entirely on the test side — it never touches the extension
 * sources. It:
 *   1. picks a random free high port (so it never collides with the IDE that
 *      may itself be running on a code-server instance);
 *   2. provisions a throwaway `--user-data-dir` and `--extensions-dir`;
 *   3. symlinks the built extension folder into the extensions dir as
 *      `<publisher>.<name>` so code-server picks it up at startup;
 *   4. spawns `code-server` detached, recording the **exact child PID**;
 *   5. polls `/healthz` until it returns 200 (or times out);
 *   6. exposes a `stop()` that kills only that PID (TERM, then KILL).
 *
 * Safety: the spawned process is the only one ever killed. We never run a
 * broad `pkill`/`killall`. The harness must work even when this whole test
 * suite is invoked from inside another code-server window.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import manifest from "../package.json";

/** Where the built extension lives (the directory containing its package.json). */
const EXTENSION_DIR = resolve(__dirname, "..");

/**
 * The identifier code-server expects when scanning `--extensions-dir`:
 * `<publisher>.<name>`. Derived from the extension's own manifest so a rename
 * or republisher change in `packages/extension/package.json` is picked up
 * automatically — there's nothing to keep in sync by hand.
 */
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;

/** The Modelica fixture workspace that ships with the harness. */
const FIXTURE_WORKSPACE = resolve(__dirname, "workspace");

/** Hard ceiling on how long we wait for `/healthz` to return 200. */
const HEALTH_TIMEOUT_MS = 30_000;

/** Polling interval while waiting for `/healthz`. */
const HEALTH_POLL_MS = 250;

/** SIGTERM → SIGKILL grace period during teardown. */
const TEARDOWN_GRACE_MS = 2_000;

export interface CodeServerHandle {
  readonly url: string;
  readonly port: number;
  readonly workspaceDir: string;
  readonly userDataDir: string;
  readonly extensionsDir: string;
  readonly logFile: string;
  readonly pid: number;
  stop(): Promise<void>;
}

/** Pick an ephemeral free port by binding port 0 and reading what the OS gave us. */
async function pickPort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolvePort(port));
      } else {
        server.close();
        rejectPort(new Error("could not derive port from server.address()"));
      }
    });
  });
}

async function waitForHealth(
  port: number,
  signal?: AbortSignal,
): Promise<void> {
  const url = `http://127.0.0.1:${port}/healthz`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr: unknown = undefined;
  while (Date.now() < deadline) {
    if (signal?.aborted)
      throw new Error("aborted while waiting for code-server");
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(HEALTH_POLL_MS);
  }
  throw new Error(
    `code-server did not become healthy on port ${port} within ${HEALTH_TIMEOUT_MS} ms ` +
      `(last error: ${String(lastErr)})`,
  );
}

async function provisionExtensionsDir(extensionsDir: string): Promise<void> {
  // Symlink the built extension folder so code-server scans it on startup. The
  // build artifacts on the source side must exist or the activation will be
  // baffling at the browser end — preflight them with a clear error here.
  const target = EXTENSION_DIR;
  const link = join(extensionsDir, EXTENSION_ID);
  await symlink(target, link, "dir");

  // The foundation contributes the tree-sitter grammar via its esbuild copyWasm
  // plugin (see `esbuild.config.mjs`), so the parse layer requires both WASM
  // files next to `extension.js` at runtime. Preflight them here for a clear
  // "rebuild" error if someone forgets `pnpm --filter modelica-wrapper build`.
  const required = [
    join(target, "package.json"),
    join(target, "out", "extension.js"),
    join(target, "out", "tree-sitter.wasm"),
    join(target, "out", "tree-sitter-modelica.wasm"),
  ];
  for (const file of required) {
    if (!existsSync(file)) {
      throw new Error(
        `e2e prerequisite missing: ${file}. Run \`pnpm --filter modelica-wrapper build\` first.`,
      );
    }
  }
}

async function provisionWorkspace(workspaceDir: string): Promise<void> {
  // Copy the fixture into the throwaway workspace so the test run never writes
  // back to the checked-in tree. `startCodeServer` already created the dir.
  const src = join(FIXTURE_WORKSPACE, "Demo.mo");
  const dst = join(workspaceDir, "Demo.mo");
  const content = await readFile(src, "utf8");
  await writeFile(dst, content, "utf8");
}

/**
 * Spawn a code-server child and resolve once `/healthz` is reachable.
 * The returned handle has a `stop()` that kills only the spawned PID.
 */
export async function startCodeServer(): Promise<CodeServerHandle> {
  const port = await pickPort();
  const root = await mkdtemp(join(tmpdir(), "mw-e2e-"));
  const userDataDir = join(root, "user-data");
  const extensionsDir = join(root, "extensions");
  const workspaceDir = join(root, "workspace");
  const logFile = join(root, "code-server.log");

  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    mkdir(workspaceDir, { recursive: true }),
  ]);

  await provisionExtensionsDir(extensionsDir);
  await provisionWorkspace(workspaceDir);

  const logStream = await open(logFile, "w");

  // Pre-seed a User/settings.json that turns off the Welcome walkthrough and
  // related first-run noise. The Workspace Trust modal is suppressed via the
  // CLI flag below.
  const userSettingsDir = join(userDataDir, "User");
  await mkdir(userSettingsDir, { recursive: true });
  await writeFile(
    join(userSettingsDir, "settings.json"),
    JSON.stringify(
      {
        "workbench.startupEditor": "none",
        "workbench.welcomePage.walkthroughs.openOnInstall": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "extensions.autoCheckUpdates": false,
        "security.workspace.trust.enabled": false,
        "security.workspace.trust.startupPrompt": "never",
      },
      null,
      2,
    ),
    "utf8",
  );

  const args = [
    "--auth",
    "none",
    "--bind-addr",
    `127.0.0.1:${port}`,
    "--disable-telemetry",
    "--disable-update-check",
    "--disable-workspace-trust",
    "--user-data-dir",
    userDataDir,
    "--extensions-dir",
    extensionsDir,
    workspaceDir,
  ];

  const child: ChildProcess = spawn("code-server", args, {
    stdio: ["ignore", logStream.fd, logStream.fd],
    detached: false,
  });

  if (!child.pid) {
    await logStream.close();
    throw new Error("code-server failed to spawn (no PID)");
  }

  // Make sure a crashed code-server surfaces as a fatal test error rather than
  // a vague Playwright timeout.
  let exited = false;
  child.once("exit", (code, signal) => {
    exited = true;
    // Best-effort: surface the exit reason. The teardown path also clears this
    // listener so a clean stop doesn't trip the warning.
    if (code !== 0 && code !== null) {
      console.error(
        `[e2e] code-server exited unexpectedly (code=${code} signal=${signal})`,
      );
    }
  });

  try {
    await waitForHealth(port);
  } catch (err) {
    // Try to kill it surgically before we throw.
    if (child.pid && !exited) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        /* best effort */
      }
    }
    await logStream.close().catch(() => {});
    throw err;
  }

  const stoppedPid = child.pid;
  const url = `http://127.0.0.1:${port}/?folder=${encodeURIComponent(workspaceDir)}`;

  async function stop(): Promise<void> {
    // Idempotent. Only kill the PID we spawned, never anything broader.
    if (!stoppedPid) return;
    try {
      process.kill(stoppedPid, "SIGTERM");
    } catch {
      /* already gone */
    }
    const killByDeadline = Date.now() + TEARDOWN_GRACE_MS;
    while (Date.now() < killByDeadline) {
      try {
        process.kill(stoppedPid, 0);
      } catch {
        // Process is gone.
        await logStream.close().catch(() => {});
        await rm(root, { recursive: true, force: true }).catch(() => {});
        return;
      }
      await delay(100);
    }
    // Still alive — force.
    try {
      process.kill(stoppedPid, "SIGKILL");
    } catch {
      /* race: already exited */
    }
    await logStream.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }

  return {
    url,
    port,
    workspaceDir,
    userDataDir,
    extensionsDir,
    logFile,
    pid: stoppedPid,
    stop,
  };
}
