import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ProcessProbe, reapOrphanedOmcSessions } from "./orphans.js";
import { OMC_PID_FILE, SESSION_DIR_PREFIX, portFileName } from "./session.js";

const SUFFIX = "mw_abc";
const PORT_FILE = portFileName(SUFFIX);
const ENDPOINT = "tcp://127.0.0.1:5555";
const OMC_PID = 4242;
const OWNER_PID = 4241;

let root: string;

async function session(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir);
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(dir, file), content, "utf8");
  }
  return dir;
}

/** A session left behind by a host that never ran its shutdown path. */
function stranded(tag: string, omcPid = OMC_PID): Promise<string> {
  return session(`${SESSION_DIR_PREFIX}${OWNER_PID}-${tag}`, {
    [OMC_PID_FILE]: `${omcPid}`,
    [PORT_FILE]: `${ENDPOINT}\n`,
  });
}

interface Probe extends ProcessProbe {
  killed: number[];
  retire: (pid: number) => void;
}

function probe(
  running: number[],
  commandLines: Record<number, string> = { [OMC_PID]: `omc -z=${SUFFIX}` },
): Probe {
  const live = new Set(running);
  const killed: number[] = [];
  return {
    killed,
    retire: (pid) => void live.delete(pid),
    isRunning: (pid) => live.has(pid),
    commandLine: (pid) => commandLines[pid],
    kill: (pid) => {
      killed.push(pid);
      live.delete(pid);
    },
  };
}

/** A `quit` that lands: OMC stops answering and exits. */
function politeQuit(processes: Probe): (endpoint: string) => Promise<void> {
  return async () => {
    processes.retire(OMC_PID);
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
    const processes = probe([OMC_PID]);
    const quit = vi.fn(politeQuit(processes));

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).toHaveBeenCalledWith(ENDPOINT);
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it("leaves a session whose owner is still running", async () => {
    await stranded("live");
    const processes = probe([OWNER_PID, OMC_PID]);
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toHaveLength(1);
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

  it("kills an OMC that accepted the quit but did not exit", async () => {
    await stranded("stuck");
    const processes = probe([OMC_PID]);

    await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(processes.killed).toEqual([OMC_PID]);
  });

  it("leaves a pid alone when its command line is not our OMC", async () => {
    await stranded("recycled-pid");
    const processes = probe([OMC_PID], { [OMC_PID]: "postgres -D /var/lib" });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
  });

  it("leaves a pid alone when its command line names another OMC session", async () => {
    await stranded("other-session");
    const processes = probe([OMC_PID], {
      [OMC_PID]: "omc -z=mw_somethingelse",
    });

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(count).toBe(1);
    expect(processes.killed).toEqual([]);
  });

  it("falls back to the pid where command lines cannot be read", async () => {
    await stranded("no-procfs");
    const processes = probe([OMC_PID], {});

    await reapOrphanedOmcSessions({
      root,
      processes,
      quit: politeQuit(processes),
    });

    expect(await readdir(root)).toEqual([]);
  });

  it("does not talk to the endpoint of a session whose OMC is already gone", async () => {
    await stranded("recycled-port");
    const processes = probe([]);
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
  });

  it("kills a stranded OMC that never published a port", async () => {
    await session(`${SESSION_DIR_PREFIX}${OWNER_PID}-noport`, {
      [OMC_PID_FILE]: `${OMC_PID}`,
    });
    const processes = probe([OMC_PID], { [OMC_PID]: "omc --interactive=zmq" });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([OMC_PID]);
  });

  it("leaves a session with no owner pid in its name untouched", async () => {
    await session(`${SESSION_DIR_PREFIX}legacy`, { [PORT_FILE]: ENDPOINT });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({
      root,
      processes: probe([]),
      quit,
    });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(await readdir(root)).toHaveLength(1);
  });

  it("reaps the other sessions when one of them throws", async () => {
    const doomedPid = 5000;
    await stranded("doomed", doomedPid);
    await stranded("fine");
    const processes = probe([doomedPid, OMC_PID]);
    processes.commandLine = (pid) => {
      if (pid === doomedPid) throw new Error("procfs exploded");
      return `omc -z=${SUFFIX}`;
    };

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: politeQuit(processes),
    });

    expect(count).toBe(1);
    expect(await readdir(root)).toHaveLength(1);
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
