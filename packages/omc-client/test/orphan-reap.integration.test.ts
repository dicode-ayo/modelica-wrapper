/**
 * Integration test for reaping a stranded OMC.
 *
 * The unit tests drive the reaper against fake session directories; this one
 * pins the part they cannot: that a real OMC, told to quit through the
 * endpoint recorded in an abandoned session directory, actually goes down.
 */

import { spawn } from "node:child_process";
import { readdir, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { expect, it } from "vitest";

import { reapOrphanedOmcSessions } from "../src/orphans.js";
import { SESSION_DIR_PREFIX, sessionDirPrefix } from "../src/session.js";
import { spawnOmc } from "../src/process.js";
import { OmcTransport } from "../src/transport.js";
import { describeIf } from "./fixtures.js";

/** A pid that named a process and no longer does. */
async function retiredPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("could not spawn a probe process");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

async function sessionDirFor(endpoint: string): Promise<string> {
  const root = tmpdir();
  for (const name of await readdir(root)) {
    if (!name.startsWith(SESSION_DIR_PREFIX)) continue;
    const dir = join(root, name);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    const portFile = files.find((f) => f.includes(".port."));
    if (portFile === undefined) continue;
    const content = await readFile(join(dir, portFile), "utf8").catch(() => "");
    if (content.trim() === endpoint) return dir;
  }
  throw new Error(`no session directory publishes ${endpoint}`);
}

async function answers(endpoint: string): Promise<boolean> {
  const transport = new OmcTransport(endpoint);
  await transport.dial();
  try {
    const reply = await transport.send("getVersion()", 3_000);
    return reply.length > 0;
  } catch {
    return false;
  } finally {
    await transport.close();
  }
}

describeIf("reaping a stranded OMC", () => {
  it("shuts down an OMC whose owner is gone and removes its tempdir", async () => {
    const proc = await spawnOmc(process.env.OMC_PATH ?? "");
    try {
      expect(await answers(proc.endpoint)).toBe(true);

      // Restamping the directory with a pid nobody holds is what a dead
      // extension host looks like to the reaper.
      const orphaned = join(
        tmpdir(),
        `${sessionDirPrefix(await retiredPid())}stranded`,
      );
      await rename(await sessionDirFor(proc.endpoint), orphaned);

      const count = await reapOrphanedOmcSessions();

      expect(count).toBeGreaterThanOrEqual(1);
      expect(await readdir(tmpdir())).not.toContain(basename(orphaned));
      expect(await answers(proc.endpoint)).toBe(false);
    } finally {
      await proc.stop();
    }
  });
});
