/**
 * Installing OpenModelica, and removing one we installed.
 *
 * An install fetches OpenModelica from conda-forge into the prefix slot that is
 * not active, proves it by running `omc --version` from that same slot, and
 * only then repoints the `current` symlink {@link resolveOmc} probes at it. A
 * prefix behind that link has therefore always run, so no health state has to be
 * tracked, and the installation being replaced stays usable until the link flips.
 *
 * Conda bakes the absolute prefix into the files it installs, so a prefix cannot
 * be built in one place and moved to another. Two alternating slots are the
 * places a prefix is built and run from for good.
 *
 * Network, subprocess, filesystem and progress are injected. The micromamba to
 * run, the digest it must match and the packages it fetches are fixed here, not
 * supplied by a caller.
 *
 * Every path is derived from the one root this extension owns, so nothing here
 * can be aimed at a directory an install did not create.
 */

import { createHash } from "node:crypto";

import { LOCKFILES, LOCKFILE_OMC_VERSION } from "./lockfile.generated.js";
import {
  condaSubdir,
  micromambaRelease,
  type CondaSubdir,
} from "./micromamba.js";
import {
  managedPrefix,
  managedRoot,
  platformPath,
  prefixOmcBinary,
} from "./resolve.js";

const SLOT_A = "prefix-a";
const SLOT_B = "prefix-b";
const SUPERSEDED_PREFIX = "previous";
const MICROMAMBA_BINARY = "micromamba";
const PACKAGE_CACHE = "cache";
const LOCKFILE_NAME = "lock.txt";

/**
 * What an install needs free under the managed root: 0.77 GB of package
 * archives, 2.9 GB of packages extracted beside them, and 0.59 GB of prefix
 * that conda copies rather than hardlinks from that cache — 4.3 GB measured on
 * linux-64 against OpenModelica 1.27.0, all of it live at once before the cache
 * is discarded. The rest is headroom for the old prefix that stays until the new one is live and for the platforms
 * that sit higher.
 */
const REQUIRED_FREE_BYTES = 5_500_000_000;

/** How far along an install is. Callers phrase these; this package does not. */
export type InstallPhase =
  | "checking-space"
  | "downloading-micromamba"
  | "verifying-micromamba"
  | "installing-openmodelica"
  | "verifying-openmodelica"
  | "finishing";

export interface InstallProgress {
  readonly phase: InstallPhase;
  readonly receivedBytes?: number | undefined;
  /** Absent when the server sent no length. */
  readonly totalBytes?: number | undefined;
  /** Whatever the child process just wrote, for a log. */
  readonly output?: string | undefined;
}

export type ReportProgress = (progress: InstallProgress) => void;

export interface DownloadRequest {
  readonly url: string;
  /** The editor's own proxy setting, so both network legs route alike. */
  readonly proxy?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?:
    | ((receivedBytes: number, totalBytes: number | undefined) => void)
    | undefined;
}

export type DownloadFile = (request: DownloadRequest) => Promise<Uint8Array>;

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** Variables to set for the child, merged over the parent environment. */
  readonly env: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal | undefined;
  readonly onOutput?: ((chunk: string) => void) | undefined;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a process to completion. Resolves for any exit code; rejecting is for a
 * process that could not be run at all, which callers here map to a failure of
 * whatever step was spawning it.
 */
export type RunProcess = (request: ProcessRequest) => Promise<ProcessResult>;

export interface InstallFileSystem {
  exists(target: string): Promise<boolean>;
  /**
   * Free bytes on the filesystem that will hold `target`, whether or not
   * `target` exists yet — the check has to happen before anything is created.
   */
  availableBytes(target: string): Promise<number>;
  /** Create it and any missing parents; succeeds when it already exists. */
  makeDirectory(target: string): Promise<void>;
  writeFile(target: string, contents: Uint8Array): Promise<void>;
  makeExecutable(target: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** Where the symlink at `target` points; undefined when absent or not a symlink. */
  readLink(target: string): Promise<string | undefined>;
  /**
   * Point the symlink `link` at `target` atomically: a reader sees the old
   * target or the new one, never neither.
   */
  replaceLink(target: string, link: string): Promise<void>;
  /**
   * Remove a file or tree; succeeds when it is already absent. A symlink is
   * removed itself, never the tree it points at.
   */
  remove(target: string): Promise<void>;
}

/** Why an install stopped, for a caller that has to say so. */
export type InstallFailure =
  | "unsupported-platform"
  | "insufficient-space"
  | "download-failed"
  | "checksum-mismatch"
  | "install-failed"
  | "verification-failed"
  | "cancelled";

export class OmcInstallError extends Error {
  readonly reason: InstallFailure;

  constructor(
    reason: InstallFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OmcInstallError";
    this.reason = reason;
  }
}

/** Every path an install touches, all of them under the root we own. */
interface ManagedLayout {
  readonly root: string;
  /** A symlink to the active slot; a real directory only from a legacy install. */
  readonly current: string;
  readonly slots: readonly [string, string];
  /** Where a legacy `current` waits while the link replaces it. */
  readonly superseded: string;
  readonly tool: string;
  readonly cache: string;
  /** Inside the cache, so the same removal that clears one clears both. */
  readonly lockfile: string;
}

function layoutFor(homeDir: string, platform: NodeJS.Platform): ManagedLayout {
  const paths = platformPath(platform);
  // A relative home directory would put every path below at the mercy of the
  // process's working directory, which is not a place this extension owns.
  if (!paths.isAbsolute(homeDir)) {
    throw new Error(
      `A managed OpenModelica needs an absolute home directory, not ${JSON.stringify(homeDir)}.`,
    );
  }
  const root = managedRoot(homeDir, platform);
  const cache = paths.join(root, PACKAGE_CACHE);
  return {
    root,
    current: managedPrefix(root, platform),
    slots: [paths.join(root, SLOT_A), paths.join(root, SLOT_B)],
    superseded: paths.join(root, SUPERSEDED_PREFIX),
    tool: paths.join(root, MICROMAMBA_BINARY),
    cache,
    lockfile: paths.join(cache, LOCKFILE_NAME),
  };
}

export interface InstallOmcInput {
  /** The user's home directory. The managed root is derived from it. */
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  /**
   * The OpenModelica to install. Callers pass the version their wrappers were
   * audited against, so an install can never produce one they warn about.
   */
  readonly version: string;
  /** `http.proxy` as the editor has it; absent when unset. */
  readonly proxy?: string | undefined;
}

export interface InstallOmcDeps {
  readonly fs: InstallFileSystem;
  readonly download: DownloadFile;
  readonly run: RunProcess;
  readonly report: ReportProgress;
  readonly signal?: AbortSignal | undefined;
}

export interface InstallOmcResult {
  readonly omcPath: string;
  /** What the installed `omc --version` printed, so the caller can show it. */
  readonly version: string;
}

/**
 * Install OpenModelica under the managed root and return the `omc` that
 * verified. Leaves nothing behind at the managed location on any failure.
 */
export async function installManagedOmc(
  input: InstallOmcInput,
  deps: InstallOmcDeps,
): Promise<InstallOmcResult> {
  const subdir = condaSubdir(input.platform, input.arch);
  if (subdir === undefined) {
    throw new OmcInstallError(
      "unsupported-platform",
      `conda-forge publishes no OpenModelica for ${input.platform}-${input.arch}.`,
    );
  }

  // The lockfile is what an install fetches, so a caller asking for anything
  // else would silently get the locked version instead. Moving the OpenModelica
  // pin means regenerating it: `pnpm --filter @dicode/omc-bootstrap
  // update:lockfiles <version>`.
  if (input.version !== LOCKFILE_OMC_VERSION) {
    throw new Error(
      `This build installs OpenModelica ${LOCKFILE_OMC_VERSION} and cannot install ${JSON.stringify(input.version)}.`,
    );
  }

  const layout = layoutFor(input.homeDir, input.platform);

  throwIfCancelled(deps.signal);
  deps.report({ phase: "checking-space" });
  const free = await deps.fs.availableBytes(layout.root);
  if (free < REQUIRED_FREE_BYTES) {
    throw new OmcInstallError(
      "insufficient-space",
      `Installing OpenModelica needs about ${gigabytes(REQUIRED_FREE_BYTES)} GB free under ${layout.root}, and ${gigabytes(free)} GB is available.`,
    );
  }

  await deps.fs.makeDirectory(layout.root);
  await restoreInterruptedSwap(layout, deps);

  const active = await deps.fs.readLink(layout.current);
  const [first, second] = layout.slots;
  const [target, old] = active === first ? [second, first] : [first, second];
  // The slot being built is not the one `current` names, so nothing resolves to
  // it and a leftover from an install that did not finish is ours to discard.
  await deps.fs.remove(target);

  try {
    await installMicromamba(layout, subdir, input, deps);
    await createPrefix(layout, target, subdir, input, deps);
    const version = await verifyPrefix(target, input.platform, deps);
    await promote(layout, target, active === undefined, deps);
    await deps.fs.remove(old);
    await discardPackageCache(layout, deps);
    return {
      omcPath: prefixOmcBinary(layout.current, input.platform),
      version,
    };
  } catch (err) {
    await deps.fs.remove(target);
    throw err;
  }
}

export interface RemoveOmcInput {
  /** The user's home directory. The managed root is derived from it. */
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
}

/**
 * Remove the installation this extension made, and report whether there was
 * one. No path comes from the caller, so an OpenModelica the user installed
 * themselves cannot be reached from here.
 */
export async function removeManagedOmc(
  input: RemoveOmcInput,
  fs: InstallFileSystem,
): Promise<boolean> {
  const layout = layoutFor(input.homeDir, input.platform);
  const installed = await fs.exists(layout.current);
  for (const entry of [
    layout.current,
    ...layout.slots,
    layout.superseded,
    layout.tool,
    layout.cache,
  ]) {
    await fs.remove(entry);
  }
  return installed;
}

/**
 * A superseded prefix with nothing at the managed location is a legacy
 * migration that was interrupted between its rename and the link. The
 * installation is still under the old name, and nothing resolves to it there.
 */
async function restoreInterruptedSwap(
  layout: ManagedLayout,
  deps: InstallOmcDeps,
): Promise<void> {
  if (await deps.fs.exists(layout.current)) return;
  if (!(await deps.fs.exists(layout.superseded))) return;
  await deps.fs.move(layout.superseded, layout.current);
}

async function installMicromamba(
  layout: ManagedLayout,
  subdir: CondaSubdir,
  input: InstallOmcInput,
  deps: InstallOmcDeps,
): Promise<void> {
  const release = micromambaRelease(subdir);
  deps.report({ phase: "downloading-micromamba" });

  let bytes: Uint8Array;
  try {
    bytes = await deps.download({
      url: release.url,
      proxy: input.proxy,
      signal: deps.signal,
      onProgress: (receivedBytes, totalBytes) =>
        deps.report({
          phase: "downloading-micromamba",
          receivedBytes,
          totalBytes,
        }),
    });
  } catch (err) {
    throwIfCancelled(deps.signal);
    throw new OmcInstallError(
      "download-failed",
      `Downloading micromamba from ${release.url} failed.`,
      { cause: err },
    );
  }

  deps.report({ phase: "verifying-micromamba" });
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256) {
    throw new OmcInstallError(
      "checksum-mismatch",
      `micromamba from ${release.url} hashed to ${digest}, not the audited ${release.sha256}.`,
    );
  }

  // Written and made runnable only past the digest check: a binary that failed
  // verification must never reach a state where the OS would execute it.
  await deps.fs.writeFile(layout.tool, bytes);
  await deps.fs.makeExecutable(layout.tool);
}

/**
 * Create the prefix in `target` from the committed lockfile.
 *
 * An explicit file names every package as a URL and the digest micromamba must
 * find behind it, so there is no solve: the environment is the one the lockfile
 * was generated against rather than whatever conda-forge holds today, every URL
 * is a conda-forge one by construction, and a package that changed underneath
 * its URL fails the install instead of entering the prefix.
 */
async function createPrefix(
  layout: ManagedLayout,
  target: string,
  subdir: CondaSubdir,
  input: InstallOmcInput,
  deps: InstallOmcDeps,
): Promise<void> {
  throwIfCancelled(deps.signal);
  deps.report({ phase: "installing-openmodelica" });
  await deps.fs.makeDirectory(layout.cache);
  await deps.fs.writeFile(
    layout.lockfile,
    new TextEncoder().encode(LOCKFILES[subdir]),
  );

  const result = await runOrFail(deps, "install-failed", {
    command: layout.tool,
    args: ["create", "--prefix", target, "--file", layout.lockfile, "--yes"],
    env: micromambaEnvironment(layout, input.proxy),
    signal: deps.signal,
    onOutput: (output) =>
      deps.report({ phase: "installing-openmodelica", output }),
  });

  if (result.exitCode !== 0) {
    throwIfCancelled(deps.signal);
    throw new OmcInstallError(
      "install-failed",
      `micromamba exited ${result.exitCode}: ${result.stderr.trim()}`,
    );
  }
}

/**
 * micromamba is a separate process and cannot read the editor's settings, so
 * the proxy a user configured once has to be handed to it explicitly. libcurl
 * ignores an uppercase `HTTP_PROXY` for plain-http URLs, so both casings are
 * set rather than the one that reads better.
 */
function micromambaEnvironment(
  layout: ManagedLayout,
  proxy: string | undefined,
): Record<string, string> {
  const environment: Record<string, string> = {
    // Keeps the package cache under the root we own, on the filesystem the
    // prefix lands on, which is what lets conda hardlink instead of copy.
    MAMBA_ROOT_PREFIX: layout.cache,
  };
  const configured = proxy?.trim();
  if (configured !== undefined && configured.length > 0) {
    environment.http_proxy = configured;
    environment.https_proxy = configured;
    environment.HTTP_PROXY = configured;
    environment.HTTPS_PROXY = configured;
  }
  return environment;
}

/**
 * Prove the prefix landed intact and that its `omc` links and runs. It runs
 * from the slot it was built in, which is also where it will run from once
 * `current` points there. The environment a conda-provided `omc` needs in order
 * to compile is applied at spawn time by `omc-client`, not here.
 */
async function verifyPrefix(
  prefix: string,
  platform: NodeJS.Platform,
  deps: InstallOmcDeps,
): Promise<string> {
  throwIfCancelled(deps.signal);
  deps.report({ phase: "verifying-openmodelica" });
  const omc = prefixOmcBinary(prefix, platform);
  const result = await runOrFail(deps, "verification-failed", {
    command: omc,
    args: ["--version"],
    env: {},
    signal: deps.signal,
  });
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || version.length === 0) {
    throwIfCancelled(deps.signal);
    throw new OmcInstallError(
      "verification-failed",
      `The installed ${omc} did not report a version (exit ${result.exitCode}).`,
    );
  }
  return version;
}

/**
 * Point `current` at the verified slot. A legacy `current` is a real directory
 * whose files name a prefix that no longer exists; it waits under another name
 * until the link is in place, since a link cannot replace a directory.
 */
async function promote(
  layout: ManagedLayout,
  target: string,
  legacy: boolean,
  deps: InstallOmcDeps,
): Promise<void> {
  deps.report({ phase: "finishing" });
  const replacing = legacy && (await deps.fs.exists(layout.current));

  if (replacing) {
    await deps.fs.remove(layout.superseded);
    await deps.fs.move(layout.current, layout.superseded);
  }
  try {
    await deps.fs.replaceLink(target, layout.current);
  } catch (err) {
    if (replacing) {
      await deps.fs
        .move(layout.superseded, layout.current)
        .catch(() => undefined);
    }
    throw new OmcInstallError(
      "install-failed",
      `Pointing ${layout.current} at the verified prefix failed.`,
      { cause: err },
    );
  }
  if (replacing) await deps.fs.remove(layout.superseded);
}

/**
 * Drop the package cache now that a prefix has landed. The 2.5 GB it shares
 * with the prefix is hardlinked, so that data survives the cache's links going
 * away; what the removal actually reclaims is the 1.4 GB nothing else points
 * at — the downloaded archives and the extracted files this prefix does not
 * use. The next install downloads them again.
 *
 * The install has already succeeded by this point, so a cache that will not
 * delete is wasted space rather than a failure.
 */
async function discardPackageCache(
  layout: ManagedLayout,
  deps: InstallOmcDeps,
): Promise<void> {
  await deps.fs.remove(layout.cache).catch(() => undefined);
}

async function runOrFail(
  deps: InstallOmcDeps,
  reason: InstallFailure,
  request: ProcessRequest,
): Promise<ProcessResult> {
  try {
    return await deps.run(request);
  } catch (err) {
    throwIfCancelled(deps.signal);
    throw new OmcInstallError(reason, `Running ${request.command} failed.`, {
      cause: err,
    });
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new OmcInstallError(
      "cancelled",
      "The OpenModelica install was cancelled.",
    );
  }
}

function gigabytes(bytes: number): string {
  return (bytes / 1_000_000_000).toFixed(1);
}
