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
  readSimulationResult(input: {
    filename: string;
    variables: string[];
  }): Promise<{ result: number[][] }>;
  /** OMC's `closeSimulationResultFile()` takes no path — it closes whatever
   * result file is currently open. We call it best-effort before re-reading a
   * rewritten file (matters only on Windows, where a stale handle can lock it). */
  closeSimulationResultFile(): Promise<unknown>;
}

interface Entry {
  mtimeMs: number;
  vars?: string[];
  series: Map<string, Trajectory>;
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
    const entry: Entry = { mtimeMs, series: new Map() };
    this.entries.set(path, entry);
    return entry;
  }

  /** Variable names in the result file (cached). `[]` if the file is missing. */
  async variables(path: string): Promise<string[]> {
    const entry = await this.fresh(path);
    if (!entry) return [];
    if (!entry.vars) {
      const reader = await this.resolveReader();
      entry.vars = (
        await reader.readSimulationResultVars({ fileName: path })
      ).vars;
    }
    return entry.vars;
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
    const reader = await this.resolveReader();
    const { result } = await reader.readSimulationResult({
      filename: path,
      variables: ["time", variable],
    });
    const t = result[0];
    const values = result[1];
    if (!t || !values || t.length === 0) return undefined;
    const traj: Trajectory = { t, values };
    entry.series.set(variable, traj);
    return traj;
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
