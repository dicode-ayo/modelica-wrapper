import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reapOrphanedOmcSessions } from "./orphans.js";
import type { ProcessProbe } from "./process-probe.js";
import { OMC_PID_FILE, SESSION_DIR_PREFIX, portFileName } from "./session.js";

const SUFFIX = "mw_abc";
const PORT_FILE = portFileName(SUFFIX);
const ENDPOINT = "tcp://127.0.0.1:5555";
const OMC_PID = 4242;
const OWNER_PID = 4241;
const OMC_COMMAND = `omc --interactive=zmq -z=${SUFFIX}`;

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

/** A session directory from a build that predates the pid-in-name scheme. */
function unstamped(tag: string): Promise<string> {
  return session(`${SESSION_DIR_PREFIX}${tag}`, {
    [PORT_FILE]: `${ENDPOINT}\n`,
  });
}

interface Probe extends ProcessProbe {
  killed: number[];
  retire: (pid: number) => void;
}

interface ProbeOptions {
  running?: number[];
  commandLines?: Record<number, string>;
  orphans?: number[];
  /** A process table this platform cannot enumerate. */
  unsearchable?: boolean;
}

function probe(options: ProbeOptions = {}): Probe {
  const live = new Set(options.running ?? [OMC_PID]);
  const commandLines = options.commandLines ?? { [OMC_PID]: OMC_COMMAND };
  const orphans = new Set(options.orphans ?? [OMC_PID]);
  const killed: number[] = [];
  return {
    killed,
    retire: (pid) => void live.delete(pid),
    isRunning: (pid) => live.has(pid),
    commandLine: (pid) => commandLines[pid],
    findByCommandLine: (fragment) => {
      if (options.unsearchable === true) return undefined;
      return [...live].filter((pid) =>
        (commandLines[pid] ?? "").includes(fragment),
      );
    },
    isOrphan: (pid) => orphans.has(pid),
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
    const processes = probe();
    const quit = vi.fn(politeQuit(processes));

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).toHaveBeenCalledWith(ENDPOINT);
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it("leaves a session whose owner is still running", async () => {
    await stranded("live");
    const processes = probe({ running: [OWNER_PID, OMC_PID] });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("kills an OMC that ignored the quit", async () => {
    await stranded("mute");
    const processes = probe();

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
    const processes = probe();

    await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(processes.killed).toEqual([OMC_PID]);
  });

  it("treats a recycled pid as proof the OMC exited", async () => {
    await stranded("recycled-pid");
    const processes = probe({
      commandLines: { [OMC_PID]: "postgres -D /var/lib" },
    });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
  });

  it("leaves another session's OMC alone when the pid was recycled onto it", async () => {
    await stranded("other-session");
    const processes = probe({
      commandLines: { [OMC_PID]: "omc --interactive=zmq -z=mw_somethingelse" },
    });

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(count).toBe(1);
    expect(processes.killed).toEqual([]);
  });

  it("spares a session whose command line cannot be read", async () => {
    await stranded("unverifiable");
    const processes = probe({ commandLines: {} });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("does not talk to the endpoint of a session whose OMC is already gone", async () => {
    await stranded("dead-omc");
    const processes = probe({ running: [] });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
  });

  it("spares a live OMC that never published a port", async () => {
    await session(`${SESSION_DIR_PREFIX}${OWNER_PID}-noport`, {
      [OMC_PID_FILE]: `${OMC_PID}`,
    });
    const processes = probe();
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(processes.killed).toEqual([]);
    expect(quit).not.toHaveBeenCalled();
    expect(await readdir(root)).toHaveLength(1);
  });

  it("removes a portless session whose pid went to something else", async () => {
    await session(`${SESSION_DIR_PREFIX}${OWNER_PID}-noport`, {
      [OMC_PID_FILE]: `${OMC_PID}`,
    });
    const processes = probe({ commandLines: { [OMC_PID]: "sshd -D" } });

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(count).toBe(1);
    expect(processes.killed).toEqual([]);
  });

  it("finds an unstamped session's OMC by its zeromq suffix", async () => {
    await unstamped("legacy");
    const processes = probe();
    const quit = vi.fn(politeQuit(processes));

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).toHaveBeenCalledWith(ENDPOINT);
    expect(await readdir(root)).toEqual([]);
  });

  it("picks the reparented match when the suffix scan returns several", async () => {
    await unstamped("legacy");
    const stray = 5150;
    const processes = probe({
      running: [stray, OMC_PID],
      commandLines: { [stray]: `grep -z=${SUFFIX}`, [OMC_PID]: OMC_COMMAND },
      orphans: [OMC_PID],
    });

    await reapOrphanedOmcSessions({
      root,
      processes,
      quit: () => Promise.reject(new Error("timed out")),
    });

    expect(processes.killed).toEqual([OMC_PID]);
  });

  it("does not signal an orphan that merely carries the suffix in its command line", async () => {
    await unstamped("legacy");
    const stray = 5150;
    const processes = probe({
      running: [stray],
      commandLines: { [stray]: `grep -r -z=${SUFFIX} /tmp` },
      orphans: [stray],
    });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("spares an unstamped session whose OMC still has a live parent", async () => {
    await unstamped("legacy");
    const processes = probe({ orphans: [] });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(0);
    expect(quit).not.toHaveBeenCalled();
    expect(processes.killed).toEqual([]);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("removes an unstamped session once its OMC is nowhere in the process table", async () => {
    await unstamped("legacy");
    const processes = probe({ running: [] });
    const quit = vi.fn(async () => undefined);

    const count = await reapOrphanedOmcSessions({ root, processes, quit });

    expect(count).toBe(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it("spares an unstamped session where the process table cannot be searched", async () => {
    await unstamped("legacy");
    const processes = probe({ unsearchable: true });

    const count = await reapOrphanedOmcSessions({
      root,
      processes,
      quit: async () => undefined,
    });

    expect(count).toBe(0);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("reaps the other sessions when one of them throws", async () => {
    const doomedPid = 5000;
    await stranded("doomed", doomedPid);
    await stranded("fine");
    const processes = probe({ running: [doomedPid, OMC_PID] });
    processes.commandLine = (pid) => {
      if (pid === doomedPid) throw new Error("procfs exploded");
      return OMC_COMMAND;
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
      processes: probe({ running: [] }),
      quit,
    });

    expect(count).toBe(0);
    expect(await readdir(root)).toEqual(["unrelated"]);
  });

  it("returns 0 when the session root does not exist", async () => {
    const count = await reapOrphanedOmcSessions({
      root: join(root, "missing"),
      processes: probe({ running: [] }),
      quit: async () => undefined,
    });

    expect(count).toBe(0);
  });
});
