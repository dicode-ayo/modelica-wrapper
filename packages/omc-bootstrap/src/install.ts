/**
 * Installing OpenModelica, and removing one we installed.
 *
 * Every install builds into a staging prefix, proves it by running
 * `omc --version`, and only then moves it into the location {@link resolveOmc}
 * probes. That ordering is the whole design: a prefix at the managed location
 * is, by definition, one that ran, so there is no health state to track and a
 * failed update cannot leave a user with nothing.
 *
 * Nothing here touches the network, a process, or a disk directly: those four
 * capabilities are injected, so the suite can pin what a failed verification or
 * a half-finished swap leaves behind without any of them. Which micromamba to
 * run, and what it must hash to, stays imported rather than injected — a digest
 * a caller supplies would verify nothing.
 */

import { createHash } from "node:crypto";

import {
  condaSubdir,
  micromambaRelease,
  type CondaSubdir,
} from "./micromamba.js";
import { managedPrefix, platformPath, prefixOmcBinary } from "./resolve.js";

/**
 * Entries under the managed root that an install creates, and so the only
 * ones removal is ever allowed to touch.
 */
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

export interface InstallOmcInput {
  /** The directory this extension owns, from `managedRoot`. */
  readonly managedRoot: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  /** Directory holding the committed per-platform lockfiles. */
  readonly lockfileDirectory: string;
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

  const paths = platformPath(input.platform);
  const root = input.managedRoot;
  const staging = paths.join(root, STAGING_PREFIX);
  const target = managedPrefix(root, input.platform);

  throwIfCancelled(deps.signal);
  deps.report({ phase: "checking-space" });
  const free = await deps.fs.availableBytes(root);
  if (free < REQUIRED_FREE_BYTES) {
    throw new OmcInstallError(
      "insufficient-space",
      `Installing OpenModelica needs about ${gigabytes(REQUIRED_FREE_BYTES)} GB free under ${root}, and ${gigabytes(free)} GB is available.`,
    );
  }

  await deps.fs.makeDirectory(root);
  // Anything already staged is from an install that did not finish. Nothing
  // resolves to it and only we create it, so it is ours to discard.
  await deps.fs.remove(staging);

  try {
    const tool = await installMicromamba(root, subdir, input, deps);
    await createPrefix(tool, staging, subdir, input, deps);
    const version = await verifyPrefix(staging, input.platform, deps);
    await promote(staging, target, root, input.platform, deps);
    return { omcPath: prefixOmcBinary(target, input.platform), version };
  } catch (err) {
    await deps.fs.remove(staging);
    throw err;
  }
}

export interface RemoveOmcInput {
  readonly managedRoot: string;
  readonly platform: NodeJS.Platform;
}

/**
 * Remove the installation this extension made, and report whether there was
 * one. Only entries an install creates are touched, so an OpenModelica the
 * user installed themselves is never at risk.
 */
export async function removeManagedOmc(
  input: RemoveOmcInput,
  fs: InstallFileSystem,
): Promise<boolean> {
  const paths = platformPath(input.platform);
  const root = input.managedRoot;
  // Every path below is a fixed name joined onto this root. A root that is
  // empty, relative, or the filesystem root would aim that join at directories
  // no install ever created.
  if (!paths.isAbsolute(root) || paths.dirname(root) === root) {
    throw new Error(
      `Refusing to remove a managed OpenModelica from ${JSON.stringify(root)}: not a directory this extension creates.`,
    );
  }

  const prefix = managedPrefix(root, input.platform);
  const installed = await fs.exists(prefix);
  for (const entry of [
    prefix,
    paths.join(root, STAGING_PREFIX),
    paths.join(root, SUPERSEDED_PREFIX),
    paths.join(root, MICROMAMBA_BINARY),
    paths.join(root, PACKAGE_CACHE),
  ]) {
    await fs.remove(entry);
  }
  return installed;
}

async function installMicromamba(
  root: string,
  subdir: CondaSubdir,
  input: InstallOmcInput,
  deps: InstallOmcDeps,
): Promise<string> {
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
  const tool = platformPath(input.platform).join(root, MICROMAMBA_BINARY);
  await deps.fs.writeFile(tool, bytes);
  await deps.fs.makeExecutable(tool);
  return tool;
}

async function createPrefix(
  tool: string,
  staging: string,
  subdir: CondaSubdir,
  input: InstallOmcInput,
  deps: InstallOmcDeps,
): Promise<void> {
  const lockfile = platformPath(input.platform).join(
    input.lockfileDirectory,
    `${subdir}.lock`,
  );
  if (!(await deps.fs.exists(lockfile))) {
    throw new OmcInstallError(
      "install-failed",
      `No lockfile for ${subdir} at ${lockfile}.`,
    );
  }

  throwIfCancelled(deps.signal);
  deps.report({ phase: "installing-openmodelica" });
  const result = await deps.run({
    command: tool,
    args: [
      "create",
      "--prefix",
      staging,
      "--file",
      lockfile,
      // The lockfile's URLs are the real pin; naming the channel as well keeps
      // an install from ever falling through to one with other licence terms.
      "--channel",
      "conda-forge",
      "--override-channels",
      "--yes",
    ],
    env: micromambaEnvironment(input),
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
 * the proxy a user configured once has to be handed to it explicitly.
 */
function micromambaEnvironment(input: InstallOmcInput): Record<string, string> {
  const environment: Record<string, string> = {
    // Keeps the package cache under the root we own, on the filesystem the
    // prefix lands on, which is what lets conda hardlink instead of copy.
    MAMBA_ROOT_PREFIX: platformPath(input.platform).join(
      input.managedRoot,
      PACKAGE_CACHE,
    ),
  };
  const proxy = input.proxy?.trim();
  if (proxy !== undefined && proxy.length > 0) {
    environment.HTTP_PROXY = proxy;
    environment.HTTPS_PROXY = proxy;
  }
  return environment;
}

async function verifyPrefix(
  staging: string,
  platform: NodeJS.Platform,
  deps: InstallOmcDeps,
): Promise<string> {
  throwIfCancelled(deps.signal);
  deps.report({ phase: "verifying-openmodelica" });
  const omc = prefixOmcBinary(staging, platform);
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
  staging: string,
  target: string,
  root: string,
  platform: NodeJS.Platform,
  deps: InstallOmcDeps,
): Promise<void> {
  deps.report({ phase: "finishing" });
  const superseded = platformPath(platform).join(root, SUPERSEDED_PREFIX);
  const replacing = await deps.fs.exists(target);

  if (replacing) {
    await deps.fs.remove(superseded);
    await deps.fs.move(target, superseded);
  }
  try {
    await deps.fs.move(staging, target);
  } catch (err) {
    if (replacing) await deps.fs.move(superseded, target);
    throw new OmcInstallError(
      "install-failed",
      `Moving the verified prefix into ${target} failed.`,
      { cause: err },
    );
  }
  if (replacing) await deps.fs.remove(superseded);
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
