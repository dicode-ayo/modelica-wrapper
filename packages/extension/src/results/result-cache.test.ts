import { describe, expect, it } from "vitest";

import { ResultCache, type ResultReader } from "./result-cache.js";

type Counting = ResultReader & {
  varsCalls: number;
  sizeCalls: number;
  seriesCalls: number;
  closeCalls: number;
};

function fakeReader(overrides: Partial<ResultReader> = {}): Counting {
  return {
    varsCalls: 0,
    sizeCalls: 0,
    seriesCalls: 0,
    closeCalls: 0,
    async readSimulationResultVars() {
      this.varsCalls++;
      return { vars: ["time", "motor.w", "motor.i"] };
    },
    async readSimulationResultSize() {
      this.sizeCalls++;
      return { size: 3 };
    },
    async readSimulationResult() {
      this.seriesCalls++;
      // row 0 = time, row 1 = the requested variable
      return {
        result: [
          [0, 1, 2],
          [10, 20, 30],
        ] satisfies number[][],
      };
    },
    async closeSimulationResultFile() {
      this.closeCalls++;
      return undefined;
    },
    ...overrides,
  } as Counting;
}

describe("ResultCache.variables", () => {
  it("reads once and caches while mtime is unchanged", async () => {
    const reader = fakeReader();
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    expect(await cache.variables("a.mat")).toEqual([
      "time",
      "motor.w",
      "motor.i",
    ]);
    await cache.variables("a.mat");
    expect(reader.varsCalls).toBe(1);
  });

  it("returns [] for a missing file", async () => {
    const reader = fakeReader();
    const cache = new ResultCache(
      async () => reader,
      async () => undefined,
    );
    expect(await cache.variables("gone.mat")).toEqual([]);
    expect(reader.varsCalls).toBe(0);
  });
});

describe("ResultCache.trajectory", () => {
  it("maps the read into {t, values} and caches per variable", async () => {
    const reader = fakeReader();
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    const traj = await cache.trajectory("a.mat", "motor.w");
    expect(traj).toEqual({ t: [0, 1, 2], values: [10, 20, 30] });
    await cache.trajectory("a.mat", "motor.w");
    expect(reader.seriesCalls).toBe(1); // cached
  });

  it("resolves the file's size once and reuses it across variables", async () => {
    const reader = fakeReader();
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    await cache.trajectory("a.mat", "motor.w");
    await cache.trajectory("a.mat", "motor.i");
    expect(reader.sizeCalls).toBe(1); // not once per variable
    expect(reader.seriesCalls).toBe(2);
  });

  it("returns undefined without reading rows when the file's resolved size is 0", async () => {
    const reader = fakeReader({
      readSimulationResultSize: async function (this: Counting) {
        this.sizeCalls++;
        return { size: 0 };
      },
    });
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    expect(await cache.trajectory("empty.mat", "motor.w")).toBeUndefined();
    expect(await cache.trajectory("empty.mat", "motor.i")).toBeUndefined();
    // Cached per file, and never falls through to a readSimulationResult
    // call that would re-trigger its own size:0 resolution.
    expect(reader.sizeCalls).toBe(1);
    expect(reader.seriesCalls).toBe(0);
  });

  it("undefined when the file is missing", async () => {
    const reader = fakeReader();
    const cache = new ResultCache(
      async () => reader,
      async () => undefined,
    );
    expect(await cache.trajectory("gone.mat", "x")).toBeUndefined();
  });

  it("undefined when the read lacks both rows", async () => {
    const reader = fakeReader({
      readSimulationResult: async () => ({ result: [[0, 1]] }),
    });
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    expect(await cache.trajectory("a.mat", "x")).toBeUndefined();
  });

  it("undefined when both rows are present but empty", async () => {
    const reader = fakeReader({
      readSimulationResult: async () => ({ result: [[], []] }),
    });
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    expect(await cache.trajectory("a.mat", "x")).toBeUndefined();
  });
});

describe("ResultCache.exists", () => {
  it("true when statMtimeMs resolves a value", async () => {
    const cache = new ResultCache(
      async () => fakeReader(),
      async () => 100,
    );
    expect(await cache.exists("a.mat")).toBe(true);
  });

  it("false when statMtimeMs resolves undefined", async () => {
    const cache = new ResultCache(
      async () => fakeReader(),
      async () => undefined,
    );
    expect(await cache.exists("gone.mat")).toBe(false);
  });
});

describe("ResultCache invalidation", () => {
  it("re-reads and closes the old handle when mtime changes", async () => {
    const reader = fakeReader();
    let mtime = 100;
    const cache = new ResultCache(
      async () => reader,
      async () => mtime,
    );

    await cache.trajectory("a.mat", "motor.w");
    expect(reader.seriesCalls).toBe(1);
    expect(reader.closeCalls).toBe(0);

    mtime = 200; // file rewritten
    await cache.trajectory("a.mat", "motor.w");
    expect(reader.seriesCalls).toBe(2); // re-read
    expect(reader.sizeCalls).toBe(2); // re-resolved, not carried across mtimes
    expect(reader.closeCalls).toBe(1); // old handle released first
  });

  it("does not close on the very first read of a path", async () => {
    const reader = fakeReader();
    const cache = new ResultCache(
      async () => reader,
      async () => 100,
    );
    await cache.variables("a.mat");
    expect(reader.closeCalls).toBe(0);
  });
});
