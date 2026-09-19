/**
 * In-memory cache of `.mat` data read through OMC, keyed by resolved file path
 * and invalidated on the file's mtime. A re-run that rewrites the same path
 * (new mtime) drops the stale entry — and, on Windows, closes OMC's handle on
 * the old file before the next read (`closeSimulationResultFile`).
 *
 * Pure of VSCode: it talks to a minimal {@link ResultReader} (the slice of
 * `OmcClient` it needs), resolved lazily per call via the injected
 * `resolveReader` thunk, plus an injectable `statMtimeMs` — so it unit-tests with
 * fakes. OMC is single-threaded; callers serialize through the shared client.
 */

import { stat } from "node:fs/promises";

/** One variable's trajectory: aligned independent + dependent samples. */
export interface Trajectory {
  t: number[];
  values: number[];
}

/** The subset of `OmcClient` the cache calls. The `fileName` / `filename`
 * casing split below mirrors OMC's own inconsistent input keys exactly — it is
 * not a typo, don't "fix" it. */
export interface ResultReader {
  readSimulationResultVars(input: {
    fileName: string;
  }): Promise<{ vars: string[] }>;
  readSimulationResultSize(input: { fileName: string }): Promise<{
    size: number;
  }>;
  readSimulationResult(input: {
    filename: string;
    variables: string[];
    size?: number;
  }): Promise<{ result: number[][] }>;
  /** OMC's `closeSimulationResultFile()` takes no path — it closes whatever
   * result file is currently open. We call it best-effort before re-reading a
   * rewritten file (matters only on Windows, where a stale handle can lock it). */
  closeSimulationResultFile(): Promise<unknown>;
}

interface Entry {
  mtimeMs: number;
  vars?: string[];
  varsPending?: Promise<string[]>;
  size?: number;
  sizePending?: Promise<number>;
  series: Map<string, Trajectory>;
  seriesPending: Map<string, Promise<Trajectory | undefined>>;
}

async function defaultStatMtimeMs(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

export class ResultCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly resolveReader: () => Promise<ResultReader>,
    private readonly statMtimeMs: (
      path: string,
    ) => Promise<number | undefined> = defaultStatMtimeMs,
  ) {}

  /**
   * The current entry for `path`, after checking the file's mtime: returns the
   * existing entry when unchanged, a fresh empty one when the file changed (its
   * OMC handle is closed first), or `undefined` when the file is missing.
   */
  private async fresh(path: string): Promise<Entry | undefined> {
    const mtimeMs = await this.statMtimeMs(path);
    if (mtimeMs === undefined) {
      this.entries.delete(path);
      return undefined;
    }
    const existing = this.entries.get(path);
    if (existing && existing.mtimeMs === mtimeMs) return existing;
    if (existing) {
      // File rewritten — drop stale data and release OMC's current handle
      // (Windows) before the next read reopens it.
      await this.closeQuietly();
    }
    const entry: Entry = {
      mtimeMs,
      series: new Map(),
      seriesPending: new Map(),
    };
    this.entries.set(path, entry);
    return entry;
  }

  /** Variable names in the result file (cached). `[]` if the file is missing. */
  async variables(path: string): Promise<string[]> {
    const entry = await this.fresh(path);
    if (!entry) return [];
    if (entry.vars) return entry.vars;
    if (!entry.varsPending) {
      entry.varsPending = this.readVars(path, entry);
    }
    return entry.varsPending;
  }

  // Caches the in-flight promise, not just the resolved value, so a second
  // concurrent caller awaits this read instead of issuing its own. A
  // rejection is not cached: the `finally` clears `varsPending` either way,
  // and `entry.vars` is only ever set on success.
  private async readVars(path: string, entry: Entry): Promise<string[]> {
    try {
      const reader = await this.resolveReader();
      const { vars } = await reader.readSimulationResultVars({
        fileName: path,
      });
      entry.vars = vars;
      return vars;
    } finally {
      delete entry.varsPending;
    }
  }

  /**
   * One variable's trajectory (cached), read against `time`. `undefined` when
   * the file is missing, or the read doesn't yield both rows with samples.
   */
  async trajectory(
    path: string,
    variable: string,
  ): Promise<Trajectory | undefined> {
    const entry = await this.fresh(path);
    if (!entry) return undefined;
    const cached = entry.series.get(variable);
    if (cached) return cached;
    const pending = entry.seriesPending.get(variable);
    if (pending) return pending;

    const promise = this.readTrajectory(path, variable, entry);
    entry.seriesPending.set(variable, promise);
    try {
      return await promise;
    } finally {
      entry.seriesPending.delete(variable);
    }
  }

  private async readTrajectory(
    path: string,
    variable: string,
    entry: Entry,
  ): Promise<Trajectory | undefined> {
    const size = await this.resolveSize(path, entry);
    if (size === 0) return undefined;
    const reader = await this.resolveReader();
    const { result } = await reader.readSimulationResult({
      filename: path,
      variables: ["time", variable],
      size,
    });
    const t = result[0];
    const values = result[1];
    if (!t || !values || t.length === 0) return undefined;
    const traj: Trajectory = { t, values };
    entry.series.set(variable, traj);
    return traj;
  }

  // readSimulationResult resolves a `size` of 0 through its own
  // readSimulationResultSize round trip, so resolve it once per file here
  // rather than once per variable a chart plots from the same result — and
  // once per concurrent caller racing this same file.
  private async resolveSize(path: string, entry: Entry): Promise<number> {
    if (entry.size !== undefined) return entry.size;
    if (!entry.sizePending) {
      entry.sizePending = this.readSize(path, entry);
    }
    return entry.sizePending;
  }

  private async readSize(path: string, entry: Entry): Promise<number> {
    try {
      const reader = await this.resolveReader();
      const { size } = await reader.readSimulationResultSize({
        fileName: path,
      });
      entry.size = size;
      return size;
    } finally {
      delete entry.sizePending;
    }
  }

  /** Whether `path` currently exists on disk (a directory counts too — this is
   *  a plain `stat`, not a file-type check). */
  async exists(path: string): Promise<boolean> {
    return (await this.statMtimeMs(path)) !== undefined;
  }

  private async closeQuietly(): Promise<void> {
    try {
      const reader = await this.resolveReader();
      await reader.closeSimulationResultFile();
    } catch {
      // best-effort: closing is only needed on Windows and never fatal here.
    }
  }
}
