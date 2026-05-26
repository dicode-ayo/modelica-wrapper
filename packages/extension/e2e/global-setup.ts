/**
 * Playwright global setup / teardown.
 *
 * Boots one code-server instance for the whole run and stashes the per-run
 * handle on a known file path so the teardown can find and kill it. We also
 * export the workbench URL via the `E2E_CODE_SERVER_URL` env var so specs can
 * read it without going through a fixture (keeps the spec dead-simple).
 *
 * The teardown is the ONLY place that calls `handle.stop()`, which kills the
 * exact PID we spawned — never a broad `pkill`.
 */

import { writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startCodeServer, type CodeServerHandle } from "./code-server-harness";

const HANDLE_FILE = join(tmpdir(), "mw-e2e-handle.json");

interface SerializedHandle {
  pid: number;
  port: number;
  url: string;
  workspaceDir: string;
  userDataDir: string;
  extensionsDir: string;
  logFile: string;
}

// Module-scoped handle so this same Node process can stop it during teardown
// without having to re-resolve from the temp file. The temp file is the
// failsafe path used when teardown runs in a different process.
let activeHandle: CodeServerHandle | undefined;

export default async function globalSetup(): Promise<() => Promise<void>> {
  const handle = await startCodeServer();
  activeHandle = handle;

  process.env["E2E_CODE_SERVER_URL"] = handle.url;
  process.env["E2E_CODE_SERVER_PORT"] = String(handle.port);
  process.env["E2E_WORKSPACE_DIR"] = handle.workspaceDir;
  process.env["E2E_CODE_SERVER_LOG"] = handle.logFile;

  const serialized: SerializedHandle = {
    pid: handle.pid,
    port: handle.port,
    url: handle.url,
    workspaceDir: handle.workspaceDir,
    userDataDir: handle.userDataDir,
    extensionsDir: handle.extensionsDir,
    logFile: handle.logFile,
  };
  await writeFile(HANDLE_FILE, JSON.stringify(serialized, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `[e2e] code-server up on ${handle.url} (pid=${handle.pid}, log=${handle.logFile})`,
  );

  // Playwright invokes the function returned here at teardown time.
  return async function globalTeardown() {
    try {
      if (activeHandle) {
        await activeHandle.stop();
        // eslint-disable-next-line no-console
        console.log(`[e2e] code-server (pid=${activeHandle.pid}) stopped`);
      } else {
        // Fall back to the on-disk handle (different process).
        const raw = await readFile(HANDLE_FILE, "utf8").catch(() => "");
        if (raw) {
          const parsed = JSON.parse(raw) as SerializedHandle;
          try {
            process.kill(parsed.pid, "SIGTERM");
          } catch {
            /* already gone */
          }
        }
      }
    } finally {
      await rm(HANDLE_FILE, { force: true }).catch(() => {});
    }
  };
}
