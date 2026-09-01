/**
 * How the resolved OpenModelica reads back to the user.
 *
 * The compatibility verdict is optional: resolving `omc` costs a file probe and
 * the verdict costs a running OMC, so the item appears at activation naming
 * which OpenModelica is in use and gains its version once a client exists.
 */

import type {
  InstallFailure,
  InstallProgress,
  OmcResolution,
  OmcSource,
} from "@dicode/omc-bootstrap";
import {
  parseOmcVersion,
  type CompatibilityLevel,
  type CompatibilityReport,
  type OmcVersion,
} from "@dicode/omc-client";

/** A modal's two halves: the sentence it leads with, and the body beneath it. */
export interface ModalPrompt {
  readonly summary: string;
  readonly detail: string;
}

/** A resolution that found something, which is the only kind worth describing. */
export interface FoundOmc {
  readonly source: OmcSource;
  readonly omcPath: string;
}

/** A compatibility verdict, paired with the binary it was read from. */
export interface OmcVerdict {
  readonly omcPath: string;
  readonly report: CompatibilityReport;
}

export interface OmcStatus {
  readonly text: string;
  readonly tooltip: string;
  /** Nothing was found, or the version is one the wrappers were never audited against. */
  readonly warn: boolean;
}

/** What to say when there is no OpenModelica, and where to send the user for one. */
export function missingOmcGuidance(platform: NodeJS.Platform): {
  readonly message: string;
  readonly downloadPage: string;
} {
  // Windows is the one platform with no automated route, so its message has to
  // carry the whole answer.
  if (platform === "win32") {
    return {
      message:
        "OpenModelica was not found. Install it with the official Windows installer, then reload the window.",
      downloadPage: "https://openmodelica.org/download/download-windows/",
    };
  }
  return {
    message:
      "OpenModelica was not found. Modelica language features and simulation need it.",
    downloadPage:
      platform === "darwin"
        ? "https://openmodelica.org/download/download-mac/"
        : "https://openmodelica.org/download/download-linux/",
  };
}

/** Which of the three OpenModelicas is in use, as a sentence. */
export function sourceSentence(source: OmcSource): string {
  switch (source) {
    case "setting":
      return "Using the omc set in modelica.omcPath.";
    case "managed":
      return "Using the OpenModelica this extension installed.";
    case "path":
      return "Using the omc found on PATH.";
  }
}

/**
 * Whether a verdict is one to warn about — and so one a fresh install could
 * resolve. The status bar and the offer to update have to agree, or a user is
 * shown a warning with no way out of it.
 */
export function verdictWarns(level: CompatibilityLevel): boolean {
  return level === "untested" || level === "unparseable";
}

/**
 * The verdict that describes the resolved binary, or nothing. A verdict read
 * from another binary says nothing about this one.
 */
export function verdictFor(
  resolution: FoundOmc,
  verdict: OmcVerdict | undefined,
): CompatibilityReport | undefined {
  if (verdict === undefined) return undefined;
  return verdict.omcPath === resolution.omcPath ? verdict.report : undefined;
}

/**
 * Everything known about the OpenModelica that was found: which one it is,
 * where it lives, and how its version was judged.
 */
export function foundOmcSentences(
  resolution: FoundOmc,
  verdict: OmcVerdict | undefined,
): string[] {
  const compatibility = verdictFor(resolution, verdict);
  return [
    sourceSentence(resolution.source),
    resolution.omcPath,
    ...(compatibility ? [verdictSentence(compatibility)] : []),
  ];
}

export function omcStatus(
  resolution: OmcResolution,
  verdict: OmcVerdict | undefined,
): OmcStatus {
  if (resolution.source === "missing") {
    return {
      text: "$(alert) OpenModelica not found",
      tooltip:
        "OpenModelica was not found.\nClick to point the extension at one.",
      warn: true,
    };
  }
  const compatibility = verdictFor(resolution, verdict);
  const version = compatibility?.omc;
  return {
    text: `$(circuit-board) OpenModelica${version ? ` ${versionTriple(version)}` : ""}`,
    tooltip: foundOmcSentences(resolution, verdict).join("\n"),
    warn: compatibility !== undefined && verdictWarns(compatibility.level),
  };
}

function versionTriple(omc: OmcVersion): string {
  return `${omc.major}.${omc.minor}.${omc.patch}`;
}

function verdictSentence(compatibility: CompatibilityReport): string {
  switch (compatibility.level) {
    case "exact":
    case "minor-compatible":
      return `Audited against ${compatibility.supportedPrimary}.`;
    case "untested":
      return `Not audited: this extension was verified against ${compatibility.supportedPrimary}.`;
    case "unparseable":
      return "Its version could not be read, so compatibility is unknown.";
  }
}

/**
 * What an install costs and where it comes from, disclosed before it starts.
 *
 * The disk figure is total loss under the managed root, not the prefix's own
 * size: 0.77 GB of package archives, 2.9 GB of packages extracted beside them,
 * and 0.59 GB of prefix that conda copies rather than hardlinks from that
 * cache. Measured at 4.3 GB on linux-64 against OpenModelica 1.27.0, and
 * quoted rounded up.
 */
export function installDisclosure(managedRoot: string): ModalPrompt {
  return {
    summary:
      "Installing OpenModelica downloads about 0.8 GB and uses about 4.4 GB of disk.",
    detail: [
      `It is installed under ${managedRoot}, which this extension owns; nothing outside it is touched, and no setting is written.`,
      "micromamba comes from github.com/mamba-org/micromamba-releases and is checked against a checksum committed in this extension before it runs. OpenModelica and its dependencies come from the conda-forge channel on conda.anaconda.org.",
      `To reclaim the space later, run "${REMOVE_TITLE}" or delete that directory.`,
    ].join("\n\n"),
  };
}

/** The command title the disclosure points at, and the command's own title. */
export const REMOVE_TITLE = "Modelica: Remove the Installed OpenModelica";

/** A managed-install operation is already running; a second cannot start. */
export const BUSY =
  "This extension is already installing or removing OpenModelica.";

/** An install stopped for a reason that is a bug rather than a condition. */
export const UNEXPECTED_FAILURE =
  "Installing OpenModelica failed unexpectedly. The log has the details.";

/** Why an install is not on offer, wherever the question is reached from. */
export const NO_MANAGED_INSTALL =
  "There is no OpenModelica package this extension can install for this platform.";

/** How far along an install is, for a progress notification. */
export function installProgressMessage(progress: InstallProgress): string {
  switch (progress.phase) {
    case "checking-space":
      return "Checking free disk space";
    case "downloading-micromamba":
      return `Downloading micromamba${percentSuffix(progress)}`;
    case "verifying-micromamba":
      return "Verifying the download";
    case "installing-openmodelica":
      return (
        lastOutputLine(progress.output) ??
        "Downloading and unpacking OpenModelica"
      );
    case "verifying-openmodelica":
      return "Checking that the installed OpenModelica runs";
    case "finishing":
      return "Finishing up";
  }
}

const MAX_OUTPUT_LINE = 100;

/**
 * The last thing the installer said. Unpacking runs for minutes, so a
 * notification carrying only the phase name cannot tell slow from stuck.
 */
function lastOutputLine(output: string | undefined): string | undefined {
  const last = output
    ?.split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (last === undefined) return undefined;
  return last.length > MAX_OUTPUT_LINE
    ? `${last.slice(0, MAX_OUTPUT_LINE)}\u2026`
    : last;
}

function percentSuffix(progress: InstallProgress): string {
  const { receivedBytes, totalBytes } = progress;
  if (
    receivedBytes === undefined ||
    totalBytes === undefined ||
    totalBytes <= 0
  ) {
    return "";
  }
  return ` (${Math.floor((receivedBytes / totalBytes) * 100)}%)`;
}

/**
 * Why an install stopped, as the user should read it.
 *
 * Only the space failure's own message is passed through: it is the one whose
 * numbers are what makes it actionable. The rest name a URL, a digest or a
 * subprocess exit code, which belong in the log.
 */
export function installFailureMessage(failure: {
  readonly reason: InstallFailure;
  readonly message: string;
}): string {
  switch (failure.reason) {
    case "unsupported-platform":
      return NO_MANAGED_INSTALL;
    case "insufficient-space":
      return failure.message;
    case "download-failed":
      return "Downloading OpenModelica failed. Check your connection, and the http.proxy setting if you are behind a proxy.";
    case "checksum-mismatch":
      return "What was downloaded did not match the checksum this extension expects, so it was not run. Nothing was installed.";
    case "install-failed":
      return "Installing OpenModelica failed. The log has what the installer reported.";
    case "verification-failed":
      return "The OpenModelica that was installed did not run, so it was discarded. Any earlier installation is unchanged.";
    case "cancelled":
      return "The OpenModelica install was cancelled.";
  }
}

/**
 * What to say once an install has verified. `version` is whatever
 * `omc --version` printed, which is a build string — `v1.27.0-cmake` — rather
 * than something to put in front of a user unaltered.
 */
export function installedMessage(version: string, managedRoot: string): string {
  const parsed = parseOmcVersion(version);
  const named = parsed === undefined ? version : versionTriple(parsed);
  return `OpenModelica ${named} is installed under ${managedRoot} and ready to use.`;
}

/** What removing the managed installation will do, before it is done. */
export function removeConfirmation(managedRoot: string): ModalPrompt {
  return {
    summary: "Remove the OpenModelica this extension installed?",
    detail: `${managedRoot} will be deleted. An OpenModelica you installed yourself is not touched, and Modelica features will use one of those if there is one.`,
  };
}

/**
 * Why an install was not started. `modelica.omcPath` outranks a managed
 * installation, so one made now would cost four gigabytes and never be used.
 */
export function settingWinsMessage(): string {
  return "modelica.omcPath names the omc to use, and it wins over anything this extension installs. Clear that setting first if you want a managed OpenModelica.";
}

export function removeFailedMessage(managedRoot: string): string {
  return `Removing ${managedRoot} failed. The log has the details.`;
}

export function removedMessage(removed: boolean): string {
  return removed
    ? "Removed the OpenModelica this extension installed."
    : "There is nothing to remove: this extension has not installed OpenModelica.";
}
