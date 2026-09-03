import { describe, expect, it, vi } from "vitest";

import {
  OmcInstallError,
  installManagedOmc,
  removeManagedOmc,
  type DownloadFile,
  type InstallFileSystem,
  type InstallOmcInput,
  type InstallProgress,
  type ProcessRequest,
  type RunProcess,
} from "./install.js";

// The audited digest is committed data, so no test can produce bytes matching
// it. This stands in a digest the fake download's own bytes satisfy.
const stub = vi.hoisted(() => ({
  url: "https://example.invalid/micromamba-linux-64",
  bytes: new Uint8Array([0x6d, 0x6d]),
}));

vi.mock("./micromamba.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./micromamba.js")>();
  const { createHash } = await import("node:crypto");
  return {
    ...actual,
    micromambaRelease: () => ({
      url: stub.url,
      sha256: createHash("sha256").update(stub.bytes).digest("hex"),
    }),
  };
});

const HOME = "/home/u";
const ROOT = `${HOME}/.openmodelica/modelica-wrapper`;
const CURRENT = `${ROOT}/current`;
const STAGING = `${ROOT}/staging`;
const PREVIOUS = `${ROOT}/previous`;
const TOOL = `${ROOT}/micromamba`;
const CACHE = `${ROOT}/cache`;
const LOCK = `${CACHE}/lock.txt`;
const VERSION = "1.27.0";

const ENOUGH_SPACE = 9_000_000_000;

const input = (overrides: Partial<InstallOmcInput> = {}): InstallOmcInput => ({
  homeDir: HOME,
  platform: "linux",
  arch: "x64",
  version: VERSION,
  ...overrides,
});

interface HarnessOptions {
  readonly existing?: readonly string[];
  readonly free?: number;
  readonly download?: DownloadFile;
  readonly run?: RunProcess;
  /** Which move to fail, so a half-finished swap can be pinned. */
  readonly moveFails?: (from: string, to: string) => boolean;
  /** Which removal to fail, for a directory the OS will not give up. */
  readonly removeFails?: (target: string) => boolean;
  readonly signal?: AbortSignal;
}

function harness(options: HarnessOptions = {}) {
  const existing = new Set(options.existing ?? []);
  const ops: string[] = [];
  const written = new Map<string, string>();
  const runs: ProcessRequest[] = [];
  const downloads: Parameters<DownloadFile>[0][] = [];
  const progress: InstallProgress[] = [];

  const base: InstallFileSystem = {
    exists: (target) => Promise.resolve(existing.has(target)),
    availableBytes: () => Promise.resolve(options.free ?? ENOUGH_SPACE),
    makeDirectory: (target) => {
      existing.add(target);
      ops.push(`mkdir ${target}`);
      return Promise.resolve();
    },
    writeFile: (target, contents) => {
      existing.add(target);
      written.set(target, new TextDecoder().decode(contents));
      ops.push(`write ${target}`);
      return Promise.resolve();
    },
    makeExecutable: (target) => {
      ops.push(`chmod ${target}`);
      return Promise.resolve();
    },
    move: (from, to) => {
      if (options.moveFails?.(from, to) === true) {
        return Promise.reject(new Error("cross-device link"));
      }
      existing.delete(from);
      existing.add(to);
      ops.push(`move ${from} -> ${to}`);
      return Promise.resolve();
    },
    remove: (target) => {
      if (options.removeFails?.(target) === true) {
        return Promise.reject(new Error("EBUSY"));
      }
      existing.delete(target);
      ops.push(`remove ${target}`);
      return Promise.resolve();
    },
  };

  // A successful micromamba leaves a prefix behind; `omc --version` reports one.
  const installs: RunProcess = (request) => {
    if (request.command === TOOL) {
      existing.add(STAGING);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: "OpenModelica 1.27.0\n",
      stderr: "",
    });
  };

  const behaviour = options.run ?? installs;
  const fetches = options.download ?? (() => Promise.resolve(stub.bytes));

  return {
    ops,
    written,
    runs,
    downloads,
    progress,
    existing,
    deps: {
      fs: base,
      download: (request) => {
        downloads.push(request);
        return fetches(request);
      },
      run: (request) => {
        runs.push(request);
        ops.push(`run ${request.command} ${request.args.join(" ")}`);
        return behaviour(request);
      },
      report: (update: InstallProgress) => progress.push(update),
      signal: options.signal,
    },
  };
}

const failure = async (run: Promise<unknown>): Promise<OmcInstallError> => {
  const err = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(err instanceof OmcInstallError)) {
    throw new Error(`Expected an OmcInstallError, got ${String(err)}`);
  }
  return err;
};

describe("installManagedOmc", () => {
  it("installs, verifies, and only then moves the prefix into place", async () => {
    const h = harness();

    const result = await installManagedOmc(input(), h.deps);

    expect(result).toEqual({
      omcPath: `${CURRENT}/bin/omc`,
      version: "OpenModelica 1.27.0",
    });
    expect(h.ops).toEqual([
      `mkdir ${ROOT}`,
      `remove ${STAGING}`,
      `write ${TOOL}`,
      `chmod ${TOOL}`,
      `mkdir ${CACHE}`,
      `write ${LOCK}`,
      `run ${TOOL} create --prefix ${STAGING} --file ${LOCK} --yes`,
      `run ${STAGING}/bin/omc --version`,
      `move ${STAGING} -> ${CURRENT}`,
      `remove ${CACHE}`,
    ]);
  });

  it("refuses a platform conda-forge publishes no OpenModelica for", async () => {
    const h = harness();

    const err = await failure(
      installManagedOmc(input({ platform: "win32" }), h.deps),
    );

    expect(err.reason).toBe("unsupported-platform");
    expect(h.downloads).toEqual([]);
    expect(h.ops).toEqual([]);
  });

  it("aborts before any transfer when the disk cannot hold the install", async () => {
    const h = harness({ free: 100_000_000 });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("insufficient-space");
    expect(h.downloads).toEqual([]);
    expect(h.ops).toEqual([]);
  });

  it("never writes or marks executable a micromamba that hashed wrong", async () => {
    const h = harness({
      download: () => Promise.resolve(new Uint8Array([0xba, 0xad])),
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("checksum-mismatch");
    expect(h.ops).not.toContain(`write ${TOOL}`);
    expect(h.ops).not.toContain(`chmod ${TOOL}`);
    expect(h.runs).toEqual([]);
  });

  it("leaves nothing at the managed location when the install fails", async () => {
    const h = harness({
      run: (request) =>
        Promise.resolve(
          request.command === TOOL
            ? { exitCode: 1, stdout: "", stderr: "solve failed" }
            : { exitCode: 0, stdout: "OpenModelica 1.27.0", stderr: "" },
        ),
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("install-failed");
    expect(h.existing.has(CURRENT)).toBe(false);
    expect(h.ops.at(-1)).toBe(`remove ${STAGING}`);
  });

  it("keeps a working installation when the replacement fails to verify", async () => {
    const h = harness({
      existing: [CURRENT],
      run: (request) => {
        if (request.command === TOOL) {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });
      },
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("verification-failed");
    expect(h.existing.has(CURRENT)).toBe(true);
    expect(h.ops).not.toContain(`move ${CURRENT} -> ${PREVIOUS}`);
  });

  it("removes the superseded prefix only once the replacement is in place", async () => {
    const h = harness({ existing: [CURRENT] });

    await installManagedOmc(input(), h.deps);

    expect(h.ops.slice(-4)).toEqual([
      `move ${CURRENT} -> ${PREVIOUS}`,
      `move ${STAGING} -> ${CURRENT}`,
      `remove ${PREVIOUS}`,
      `remove ${CACHE}`,
    ]);
  });

  it("keeps the package cache when the install fails, so a retry is cheap", async () => {
    const h = harness({
      run: (request) =>
        Promise.resolve(
          request.command === TOOL
            ? { exitCode: 1, stdout: "", stderr: "solve failed" }
            : { exitCode: 0, stdout: "OpenModelica 1.27.0", stderr: "" },
        ),
    });

    await failure(installManagedOmc(input(), h.deps));

    expect(h.ops).not.toContain(`remove ${CACHE}`);
  });

  it("installs even when the package cache will not delete", async () => {
    const h = harness({ removeFails: (target) => target === CACHE });

    const result = await installManagedOmc(input(), h.deps);

    expect(result.omcPath).toBe(`${CURRENT}/bin/omc`);
    expect(h.existing.has(CURRENT)).toBe(true);
  });

  it("puts the superseded installation back when the swap fails", async () => {
    const h = harness({
      existing: [CURRENT],
      moveFails: (from) => from === STAGING,
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("install-failed");
    expect(h.ops).toContain(`move ${PREVIOUS} -> ${CURRENT}`);
  });

  it("gives micromamba a cache under the managed root and the editor's proxy", async () => {
    const proxy = "http://proxy.corp:3128";
    const h = harness();

    await installManagedOmc(input({ proxy }), h.deps);

    expect(h.downloads.at(0)?.proxy).toBe(proxy);
    expect(h.runs.find((r) => r.command === TOOL)?.env).toEqual({
      MAMBA_ROOT_PREFIX: CACHE,
      http_proxy: proxy,
      https_proxy: proxy,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
    });
  });

  it("leaves the child environment alone when no proxy is configured", async () => {
    const h = harness();

    await installManagedOmc(input({ proxy: "  " }), h.deps);

    expect(h.runs.find((r) => r.command === TOOL)?.env).toEqual({
      MAMBA_ROOT_PREFIX: CACHE,
    });
  });

  it("types a failure to spawn micromamba rather than letting it escape", async () => {
    const h = harness({
      run: (request) =>
        request.command === TOOL
          ? Promise.reject(new Error("ENOENT"))
          : Promise.resolve({ exitCode: 0, stdout: "1.27.0", stderr: "" }),
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("install-failed");
    expect(h.existing.has(CURRENT)).toBe(false);
  });

  it("refuses a version the committed lockfile does not install", async () => {
    for (const version of ["", "latest", "1.26.4"]) {
      const h = harness();

      await expect(
        installManagedOmc(input({ version }), h.deps),
      ).rejects.toThrow(/committed lockfile installs OpenModelica/);
      expect(h.downloads).toEqual([]);
      expect(h.runs).toEqual([]);
    }
  });

  it("refuses a home directory that is not absolute", async () => {
    const h = harness();

    await expect(
      installManagedOmc(input({ homeDir: "relative/path" }), h.deps),
    ).rejects.toThrow(/absolute home directory/);
    expect(h.downloads).toEqual([]);
  });

  it("stops before downloading anything once cancelled", async () => {
    const h = harness({ signal: AbortSignal.abort() });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("cancelled");
    expect(h.downloads).toEqual([]);
  });

  it("fetches only digest-pinned conda-forge packages", async () => {
    const h = harness();

    await installManagedOmc(input(), h.deps);

    const [header, ...urls] = (h.written.get(LOCK) ?? "").trim().split("\n");
    expect(header).toBe("@EXPLICIT");
    expect(urls.length).toBeGreaterThan(0);
    expect(
      urls.filter(
        (url) =>
          !/^https:\/\/conda\.anaconda\.org\/conda-forge\/.+#[0-9a-f]{64}$/.test(
            url,
          ),
      ),
    ).toEqual([]);
  });

  it("locks the subdir the install is running on, not the one it was generated on", async () => {
    const h = harness();

    await installManagedOmc(
      input({ platform: "darwin", arch: "arm64" }),
      h.deps,
    );

    expect(h.written.get(LOCK)).toContain("/conda-forge/osx-arm64/");
  });

  it("recovers an installation stranded by an interrupted swap", async () => {
    const h = harness({ existing: [PREVIOUS] });

    await installManagedOmc(input(), h.deps);

    expect(h.ops.at(1)).toBe(`move ${PREVIOUS} -> ${CURRENT}`);
    expect(h.existing.has(PREVIOUS)).toBe(false);
    expect(h.existing.has(CURRENT)).toBe(true);
  });
});

describe("removeManagedOmc", () => {
  it("removes every entry an install creates, and says one was there", async () => {
    const h = harness({ existing: [CURRENT] });

    const removed = await removeManagedOmc(
      { homeDir: HOME, platform: "linux" },
      h.deps.fs,
    );

    expect(removed).toBe(true);
    expect(h.ops).toEqual([
      `remove ${CURRENT}`,
      `remove ${STAGING}`,
      `remove ${PREVIOUS}`,
      `remove ${TOOL}`,
      `remove ${CACHE}`,
    ]);
  });

  it("reports nothing removed when no installation was made", async () => {
    const h = harness({ existing: [] });

    expect(
      await removeManagedOmc({ homeDir: HOME, platform: "linux" }, h.deps.fs),
    ).toBe(false);
  });

  it("answers for a Windows host instead of refusing it", async () => {
    const root = "C:\\Users\\u\\.openmodelica\\modelica-wrapper";
    const h = harness({ existing: [] });

    expect(
      await removeManagedOmc(
        { homeDir: "C:\\Users\\u", platform: "win32" },
        h.deps.fs,
      ),
    ).toBe(false);
    expect(h.ops).toEqual([
      `remove ${root}\\current`,
      `remove ${root}\\staging`,
      `remove ${root}\\previous`,
      `remove ${root}\\micromamba`,
      `remove ${root}\\cache`,
    ]);
  });

  it("refuses a home directory that is not absolute", async () => {
    for (const homeDir of ["", "relative/path"]) {
      const h = harness({ existing: [] });

      await expect(
        removeManagedOmc({ homeDir, platform: "linux" }, h.deps.fs),
      ).rejects.toThrow(/absolute home directory/);
      expect(h.ops).toEqual([]);
    }
  });

  it("only ever removes paths inside the directory this extension owns", async () => {
    for (const homeDir of ["/", "/home/u"]) {
      const h = harness({ existing: [] });
      const owned = `remove ${homeDir === "/" ? "" : homeDir}/.openmodelica/modelica-wrapper/`;

      await removeManagedOmc({ homeDir, platform: "linux" }, h.deps.fs);

      expect(h.ops).toHaveLength(5);
      for (const op of h.ops) expect(op.startsWith(owned)).toBe(true);
    }
  });
});
