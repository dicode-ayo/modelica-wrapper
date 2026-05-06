/**
 * Supported OpenModelica versions for this package.
 *
 * The audit runbook (`docs/audit.md`) treats `SUPPORTED_OMC.primary` as the
 * version against which the OMC scripting API surface was last verified.
 *
 * The package will still work against other OMC versions — OMC's interactive
 * API is largely stable across minor releases — but field-name and default-
 * value drift can happen. Use `OmcClient.getVersionStatus()` to surface
 * whether the connected OMC matches.
 */

/** Semantic version triple parsed from OMC's `getVersion()` response. */
export interface OmcVersion {
  major: number;
  minor: number;
  patch: number;
  /** Original full string, e.g. "OpenModelica 1.26.1" or "OpenModelica v1.27.0-dev-123-g..". */
  raw: string;
}

/**
 * The OMC version this package's wrappers were verified against.
 *
 * When updating: change `primary`, run the audit (see docs/audit.md), bump
 * any wrappers whose schemas drifted, then commit together.
 */
export const SUPPORTED_OMC = {
  /**
   * Exact version we tested against.
   *
   * **Renovate-managed** via the regex customManager in `renovate.json`. When
   * Renovate proposes a bump, the audit workflow runs the test suite against
   * the new OMC and a human reviews the resulting `coverage.md` deltas
   * before merge. Do not edit by hand outside of a Renovate PR — keep
   * `auditedOn` in sync.
   */
  primary: "1.26.7",
  /** Same major.minor is treated as compatible without warning. */
  compatibleMinor: { major: 1, minor: 26 },
  /** Audited against build.openmodelica.org docs on this date. */
  auditedOn: "2026-05-06",
} as const;

/** Parse OMC's `getVersion()` response into a structured version. */
export function parseOmcVersion(raw: string): OmcVersion | undefined {
  // Examples we have to handle:
  //   "OpenModelica 1.26.1"
  //   "OpenModelica v1.27.0-dev-184-g..."
  //   "1.24.0+ds-1"
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: raw.trim(),
  };
}

/** Three-tier compatibility verdict for a runtime-connected OMC. */
export type CompatibilityLevel =
  | "exact" // matches SUPPORTED_OMC.primary verbatim
  | "minor-compatible" // same major.minor
  | "untested" // different major.minor — may work, may not
  | "unparseable"; // version string didn't match a recognizable shape

export interface CompatibilityReport {
  /** The runtime OMC version, parsed if possible. */
  omc: OmcVersion | undefined;
  /** The version this package was last verified against. */
  supportedPrimary: string;
  level: CompatibilityLevel;
}

export function compatibilityReport(rawVersion: string): CompatibilityReport {
  const omc = parseOmcVersion(rawVersion);
  if (!omc) {
    return {
      omc: undefined,
      supportedPrimary: SUPPORTED_OMC.primary,
      level: "unparseable",
    };
  }
  if (omc.raw.includes(SUPPORTED_OMC.primary)) {
    return {
      omc,
      supportedPrimary: SUPPORTED_OMC.primary,
      level: "exact",
    };
  }
  if (
    omc.major === SUPPORTED_OMC.compatibleMinor.major &&
    omc.minor === SUPPORTED_OMC.compatibleMinor.minor
  ) {
    return {
      omc,
      supportedPrimary: SUPPORTED_OMC.primary,
      level: "minor-compatible",
    };
  }
  return {
    omc,
    supportedPrimary: SUPPORTED_OMC.primary,
    level: "untested",
  };
}
