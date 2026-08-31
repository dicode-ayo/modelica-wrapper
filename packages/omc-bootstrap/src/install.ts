/**
 * Installing OpenModelica, and removing one we installed.
 *
 * An install resolves OpenModelica from conda-forge into a staging prefix,
 * proves it by running `omc --version`,
 * and only then moves it into the location {@link resolveOmc} probes. A prefix
 * at that location has therefore always run, so no health state has to be
 * tracked, and the installation being replaced stays on disk under another name
 * until the new one has landed.
 *
 * Network, subprocess, filesystem and progress are injected. The micromamba to
 * run and the digest it must match are fixed here, not supplied by a caller.
 *
 * Every path is derived from the one root this extension owns, so nothing here
 * can be aimed at a directory an install did not create.
 */

import { createHash } from "node:crypto";

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

const STAGING_PREFIX = "staging";
const SUPERSEDED_PREFIX = "previous";
const MICROMAMBA_BINARY = "micromamba";
const PACKAGE_CACHE = "cache";

/**
 * What an install needs free under the managed root: 0.8 GB of package
 * archives plus a 3.1 GB extracted cache, with the prefix itself hardlinked
 * from that cache and so nearly free — 4.4 GB measured on linux-64 against the
 * pinned OpenModelica. The rest is headroom for the platforms that sit higher.
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

export type RunProcess = (request: ProcessRequest) => Promise<ProcessResult>;

export interface InstallFileSystem {
  exists(target: string): Promise<boolean>;
  /**
   * Free bytes on the filesystem that will hold `target`, whether or not
   * `target` exists yet — the check has to happen before anything is created.
   */
  availableBytes(target: string): Promise<number>;
  makeDirectory(target: string): Promise<void>;
  writeFile(target: string, contents: Uint8Array): Promise<void>;
  makeExecutable(target: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** Remove a file or tree; succeeds when it is already absent. */
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
  readonly current: string;
  readonly staging: string;
  readonly superseded: string;
  readonly tool: string;
  readonly cache: string;
}

function layoutFor(homeDir: string, platform: NodeJS.Platform): ManagedLayout {
  const paths = platformPath(platform);
  const root = managedRoot(homeDir, platform);
  return {
    root,
    current: managedPrefix(root, platform),
    staging: paths.join(root, STAGING_PREFIX),
    superseded: paths.join(root, SUPERSEDED_PREFIX),
    tool: paths.join(root, MICROMAMBA_BINARY),
    cache: paths.join(root, PACKAGE_CACHE),
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
  // Anything already staged is from an install that did not finish. Nothing
  // resolves to it and only we create it, so it is ours to discard.
  await deps.fs.remove(layout.staging);

  try {
    await installMicromamba(layout, subdir, input, deps);
    await createPrefix(layout, input, deps);
    const version = await verifyPrefix(layout, input.platform, deps);
    await promote(layout, deps);
    return {
      omcPath: prefixOmcBinary(layout.current, input.platform),
      version,
    };
  } catch (err) {
    await deps.fs.remove(layout.staging);
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
    layout.staging,
    layout.superseded,
    layout.tool,
    layout.cache,
  ]) {
    await fs.remove(entry);
  }
  return installed;
}

/**
 * A superseded prefix with nothing at the managed location is a swap that was
 * interrupted between its two renames. The working installation is the one
 * still under the old name, and nothing resolves to it there.
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

async function createPrefix(
  layout: ManagedLayout,
  input: InstallOmcInput,
  deps: InstallOmcDeps,
): Promise<void> {
  throwIfCancelled(deps.signal);
  deps.report({ phase: "installing-openmodelica" });
  const result = await deps.run({
    command: layout.tool,
    args: [
      "create",
      "--prefix",
      layout.staging,
      // Pinned in code rather than left to micromamba's default, so an install
      // can never fall through to a channel with other licence terms.
      "--channel",
      "conda-forge",
      "--override-channels",
      "--yes",
      `openmodelica=${input.version}`,
    ],
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

async function verifyPrefix(
  layout: ManagedLayout,
  platform: NodeJS.Platform,
  deps: InstallOmcDeps,
): Promise<string> {
  throwIfCancelled(deps.signal);
  deps.report({ phase: "verifying-openmodelica" });
  const omc = prefixOmcBinary(layout.staging, platform);
  const result = await deps.run({
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
 * Move the verified prefix into place, keeping the installation being replaced
 * on disk until the new one has landed.
 */
async function promote(
  layout: ManagedLayout,
  deps: InstallOmcDeps,
): Promise<void> {
  deps.report({ phase: "finishing" });
  const replacing = await deps.fs.exists(layout.current);

  if (replacing) {
    await deps.fs.remove(layout.superseded);
    await deps.fs.move(layout.current, layout.superseded);
  }
  try {
    await deps.fs.move(layout.staging, layout.current);
  } catch (err) {
    if (replacing) await deps.fs.move(layout.superseded, layout.current);
    throw new OmcInstallError(
      "install-failed",
      `Moving the verified prefix into ${layout.current} failed.`,
      { cause: err },
    );
  }
  if (replacing) await deps.fs.remove(layout.superseded);
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
