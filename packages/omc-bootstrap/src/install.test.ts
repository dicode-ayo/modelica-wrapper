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
import { LOCKFILE_OMC_VERSION } from "./lockfile.generated.js";

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
const SLOT_A = `${ROOT}/prefix-a`;
const SLOT_B = `${ROOT}/prefix-b`;
const PREVIOUS = `${ROOT}/previous`;
const TOOL = `${ROOT}/micromamba`;
const CACHE = `${ROOT}/cache`;
const LOCK = `${CACHE}/lock.txt`;
// The installer refuses any version the lockfile does not carry, so the
// fixture has to track the lockfile rather than restate a version that
// goes stale the next time the pin moves.
const VERSION = LOCKFILE_OMC_VERSION;
const REPORTED = `OpenModelica ${VERSION}`;

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
  /** Symlinks that already exist, as link path to target. */
  readonly links?: Readonly<Record<string, string>>;
  /** Which link flip to fail. */
  readonly replaceLinkFails?: boolean;
  /** Which move to fail, so a half-finished swap can be pinned. */
  readonly moveFails?: (from: string, to: string) => boolean;
  /** Which removal to fail, for a directory the OS will not give up. */
  readonly removeFails?: (target: string) => boolean;
  readonly signal?: AbortSignal;
}

function harness(options: HarnessOptions = {}) {
  const links = new Map(Object.entries(options.links ?? {}));
  const existing = new Set([
    ...(options.existing ?? []),
    ...links.keys(),
    ...links.values(),
  ]);
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
    readLink: (target) => Promise.resolve(links.get(target)),
    replaceLink: (target, link) => {
      if (options.replaceLinkFails === true) {
        return Promise.reject(new Error("EPERM"));
      }
      links.set(link, target);
      existing.add(link);
      ops.push(`link ${link} -> ${target}`);
      return Promise.resolve();
    },
    remove: (target) => {
      if (options.removeFails?.(target) === true) {
        return Promise.reject(new Error("EBUSY"));
      }
      existing.delete(target);
      links.delete(target);
      ops.push(`remove ${target}`);
      return Promise.resolve();
    },
  };

  // A successful micromamba leaves a prefix behind; `omc --version` reports one.
  const installs: RunProcess = (request) => {
    if (request.command === TOOL) {
      const prefix = request.args[request.args.indexOf("--prefix") + 1];
      if (prefix !== undefined) existing.add(prefix);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: `${REPORTED}\n`,
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
    links,
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
  it("installs, verifies, and only then points current at the prefix", async () => {
    const h = harness();

    const result = await installManagedOmc(input(), h.deps);

    expect(result).toEqual({
      omcPath: `${CURRENT}/bin/omc`,
      version: REPORTED,
    });
    expect(h.ops).toEqual([
      `mkdir ${ROOT}`,
      `remove ${SLOT_A}`,
      `write ${TOOL}`,
      `chmod ${TOOL}`,
      `mkdir ${CACHE}`,
      `write ${LOCK}`,
      `run ${TOOL} create --prefix ${SLOT_A} --file ${LOCK} --yes`,
      `run ${SLOT_A}/bin/omc --version`,
      `link ${CURRENT} -> ${SLOT_A}`,
      `remove ${SLOT_B}`,
      `remove ${CACHE}`,
    ]);
  });

  it("verifies the prefix it created and leaves current pointing at that same prefix", async () => {
    const h = harness();

    await installManagedOmc(input(), h.deps);

    const created = h.runs.find((r) => r.command === TOOL)?.args;
    const prefix = created?.[created.indexOf("--prefix") + 1];
    const verified = h.runs.find((r) => r.args.join(" ") === "--version");
    expect(prefix).toBeDefined();
    expect(verified?.command).toBe(`${prefix}/bin/omc`);
    expect(h.links.get(CURRENT)).toBe(prefix);
  });

  it("never moves a prefix once conda has created it", async () => {
    for (const existing of [[], [CURRENT]]) {
      for (const links of [{}, { [CURRENT]: SLOT_A }, { [CURRENT]: SLOT_B }]) {
        const h = harness({ existing, links });

        await installManagedOmc(input(), h.deps);

        const moved = h.ops.filter((op) => op.startsWith("move "));
        for (const op of moved) {
          expect(op).not.toMatch(/prefix-[ab]/);
        }
      }
    }
  });

  it("builds in the slot that is not active and removes the old one after the flip", async () => {
    const h = harness({ links: { [CURRENT]: SLOT_A } });

    await installManagedOmc(input(), h.deps);

    expect(h.runs.find((r) => r.command === TOOL)?.args).toContain(SLOT_B);
    expect(h.links.get(CURRENT)).toBe(SLOT_B);
    const flip = h.ops.indexOf(`link ${CURRENT} -> ${SLOT_B}`);
    expect(flip).toBeGreaterThan(-1);
    expect(h.ops.indexOf(`remove ${SLOT_A}`)).toBeGreaterThan(flip);
    expect(h.existing.has(SLOT_A)).toBe(false);
  });

  it("alternates back to the first slot on a third install", async () => {
    const h = harness();

    await installManagedOmc(input(), h.deps);
    await installManagedOmc(input(), h.deps);
    expect(h.links.get(CURRENT)).toBe(SLOT_B);
    await installManagedOmc(input(), h.deps);

    expect(h.links.get(CURRENT)).toBe(SLOT_A);
    expect(h.existing.has(SLOT_B)).toBe(false);
  });

  it("migrates a legacy real-directory current into the first slot", async () => {
    const h = harness({ existing: [CURRENT] });

    await installManagedOmc(input(), h.deps);

    expect(h.runs.find((r) => r.command === TOOL)?.args).toContain(SLOT_A);
    expect(h.links.get(CURRENT)).toBe(SLOT_A);
    expect(h.existing.has(PREVIOUS)).toBe(false);
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
            : { exitCode: 0, stdout: REPORTED, stderr: "" },
        ),
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("install-failed");
    expect(h.existing.has(CURRENT)).toBe(false);
    expect(h.ops.at(-1)).toBe(`remove ${SLOT_A}`);
  });

  it("keeps a working installation when the replacement fails to verify", async () => {
    const h = harness({
      links: { [CURRENT]: SLOT_A },
      run: (request) => {
        if (request.command === TOOL) {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });
      },
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("verification-failed");
    expect(h.links.get(CURRENT)).toBe(SLOT_A);
    expect(h.existing.has(SLOT_A)).toBe(true);
    expect(h.existing.has(SLOT_B)).toBe(false);
    expect(h.ops.some((op) => op.startsWith("link "))).toBe(false);
  });

  it("removes the superseded prefix only once the replacement is in place", async () => {
    const h = harness({ existing: [CURRENT] });

    await installManagedOmc(input(), h.deps);

    expect(h.ops.slice(-5)).toEqual([
      `move ${CURRENT} -> ${PREVIOUS}`,
      `link ${CURRENT} -> ${SLOT_A}`,
      `remove ${PREVIOUS}`,
      `remove ${SLOT_B}`,
      `remove ${CACHE}`,
    ]);
  });

  it("keeps the package cache when the install fails, so a retry is cheap", async () => {
    const h = harness({
      run: (request) =>
        Promise.resolve(
          request.command === TOOL
            ? { exitCode: 1, stdout: "", stderr: "solve failed" }
            : { exitCode: 0, stdout: REPORTED, stderr: "" },
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

  it("puts a legacy installation back when the link cannot be made", async () => {
    const h = harness({ existing: [CURRENT], replaceLinkFails: true });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("install-failed");
    expect(h.ops).toContain(`move ${PREVIOUS} -> ${CURRENT}`);
    expect(h.existing.has(CURRENT)).toBe(true);
    expect(h.existing.has(SLOT_A)).toBe(false);
  });

  it("keeps the active installation when the link flip fails", async () => {
    const h = harness({
      links: { [CURRENT]: SLOT_A },
      replaceLinkFails: true,
    });

    const err = await failure(installManagedOmc(input(), h.deps));

    expect(err.reason).toBe("install-failed");
    expect(h.links.get(CURRENT)).toBe(SLOT_A);
    expect(h.existing.has(SLOT_A)).toBe(true);
    expect(h.existing.has(SLOT_B)).toBe(false);
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
          : Promise.resolve({ exitCode: 0, stdout: VERSION, stderr: "" }),
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
      ).rejects.toThrow(/cannot install/);
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
    const h = harness({ links: { [CURRENT]: SLOT_A } });

    const removed = await removeManagedOmc(
      { homeDir: HOME, platform: "linux" },
      h.deps.fs,
    );

    expect(removed).toBe(true);
    expect(h.ops).toEqual([
      `remove ${CURRENT}`,
      `remove ${SLOT_A}`,
      `remove ${SLOT_B}`,
      `remove ${PREVIOUS}`,
      `remove ${TOOL}`,
      `remove ${CACHE}`,
    ]);
    expect(h.existing.has(SLOT_A)).toBe(false);
    expect(h.links.has(CURRENT)).toBe(false);
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
      `remove ${root}\\prefix-a`,
      `remove ${root}\\prefix-b`,
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

      expect(h.ops).toHaveLength(6);
      for (const op of h.ops) expect(op.startsWith(owned)).toBe(true);
    }
  });
});
