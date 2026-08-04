import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OMC_PID_FILE,
  OWNER_PID_FILE,
  SESSION_DIR_PREFIX,
  type ProcessProbe,
  reapOrphanedOmcSessions,
} from "./orphans.js";

const PORT_FILE = "openmodelica.mw.port.mw_abc";
const OMC_PID = 4242;
const OWNER_PID = 4241;

let root: string;

async function session(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const dir = join(root, `${SESSION_DIR_PREFIX}${name}`);
  await mkdir(dir);
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(dir, file), content, "utf8");
  }
  return dir;
}

/** A session left behind by a host that never ran its shutdown path. */
function stranded(
  name: string,
  endpoint = "tcp://127.0.0.1:5555",
): Promise<string> {
  return session(name, {
    [OWNER_PID_FILE]: `${OWNER_PID}`,
    [OMC_PID_FILE]: `${OMC_PID}`,
    [PORT_FILE]: `${endpoint}\n`,
  });
}

/** Push a directory's mtime past the grace period for unowned sessions. */
async function age(dir: string): Promise<void> {
  const longAgo = new Date(Date.now() - 60_000);
  await utimes(dir, longAgo, longAgo);
}

function probe(
  running: number[],
): ProcessProbe & { killed: number[]; retire: (pid: number) => void } {
  const live = new Set(running);
  const killed: number[] = [];
  return {
    killed,
    retire: (pid) => void live.delete(pid),
    isRunning: (pid) => live.has(pid),
    kill: (pid) => {
      killed.push(pid);
      live.delete(pid);
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-orphans-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reapOrphanedOmcSessions", () => {
  it("quits and removes a session whose owner is gone", async () => {
    await stranded("dead");
    const quit = vi.fn(async () => undefined);
    const processes = probe([OMC_PID]);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).toHaveBeenCalledWith("tcp://127.0.0.1:5555");
    expect(await readdir(root)).toEqual([]);
  });

  it("leaves a session whose owner is still running", async () => {
    await stranded("live");
    const quit = vi.fn(async () => undefined);
    const processes = probe([OWNER_PID, OMC_PID]);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("spares a just-created session that has not written its owner pid", async () => {
    await session("racing", {});
    const processes = probe([]);

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(count).toBe(0);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("removes an aged session that has no owner pid", async () => {
    const dir = await session("legacy", {
      [PORT_FILE]: "tcp://127.0.0.1:5557",
    });
    await age(dir);

    const count = await reapOrphanedOmcSessions({
      root,
      processes: probe([]),
      quit: async () => undefined,
    });

    expect(count).toBe(1);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not talk to the endpoint of a session whose OMC is already gone", async () => {
    await stranded("recycled-port");
    const quit = vi.fn(async () => undefined);
    const processes = probe([]);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
  });

  it("kills an OMC that ignored the quit", async () => {
    await stranded("mute");
    const processes = probe([OMC_PID]);

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: () => Promise.reject(new Error("timed out")),
    });

    expect(count).toBe(1);
    expect(processes.killed).toEqual([OMC_PID]);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not kill an OMC that quit on request", async () => {
    await stranded("polite");
    const processes = probe([OMC_PID]);

    await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async (endpoint) => {
        expect(endpoint).toBe("tcp://127.0.0.1:5555");
        processes.retire(OMC_PID);
      },
    });

    expect(processes.killed).toEqual([]);
  });

  it("kills a stranded OMC that never published a port", async () => {
    await session("noport", {
      [OWNER_PID_FILE]: `${OWNER_PID}`,
      [OMC_PID_FILE]: `${OMC_PID}`,
    });
    const quit = vi.fn(async () => undefined);
    const processes = probe([OMC_PID]);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([OMC_PID]);
  });

  it("ignores directories that are not OMC sessions", async () => {
    await mkdir(join(root, "unrelated"));
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({
      root,
      processes: probe([]),
      quit,
    });

    expect(count).toBe(0);
    expect(await readdir(root)).toEqual(["unrelated"]);
  });

  it("returns 0 when the session root does not exist", async () => {
    const count = await reapOrphanedOmcSessions({
      root: join(root, "missing"),
      processes: probe([]),
      quit: async () => undefined,
    });

    expect(count).toBe(0);
  });
});
