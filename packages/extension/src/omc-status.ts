/**
 * How the resolved OpenModelica reads back to the user.
 *
 * The compatibility verdict is optional: resolving `omc` costs a file probe and
 * the verdict costs a running OMC, so the item appears at activation naming
 * which OpenModelica is in use and gains its version once a client exists.
 */

import type { OmcResolution, OmcSource } from "@dicode/omc-bootstrap";
import type { CompatibilityReport } from "@dicode/omc-client";

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
  // A verdict read from another binary says nothing about this one.
  const compatibility =
    verdict?.omcPath === resolution.omcPath ? verdict.report : undefined;
  const version = compatibility?.omc;
  return {
    text: `$(circuit-board) OpenModelica${version ? ` ${version.major}.${version.minor}.${version.patch}` : ""}`,
    tooltip: [
      sourceSentence(resolution.source),
      resolution.omcPath,
      ...(compatibility ? [verdictSentence(compatibility)] : []),
    ].join("\n"),
    warn:
      compatibility?.level === "untested" ||
      compatibility?.level === "unparseable",
  };
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
