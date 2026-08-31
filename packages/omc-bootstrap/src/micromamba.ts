/**
 * Which micromamba an install runs, and which OpenModelica it can install.
 *
 * The release tag and the SHA-256 of every asset sit in one file so that a
 * bump is a single diff a reviewer can judge whole. A checksum served beside
 * the binary would only show the host agreeing with itself; these were read
 * once by a human and committed.
 *
 * The two pins must move together. A tag bumped on its own fails every install
 * at the digest check, which is the direction this is meant to fail in.
 */

/**
 * conda's name for a platform. It is also the suffix of the micromamba release
 * asset and of the committed lockfile, so one mapping serves all three.
 */
export type CondaSubdir = "linux-64" | "linux-aarch64" | "osx-64" | "osx-arm64";

const MICROMAMBA_TAG = "2.9.0-0";

const MICROMAMBA_SHA256: Readonly<Record<CondaSubdir, string>> = {
  "linux-64":
    "366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3",
  "linux-aarch64":
    "9f93b974adcb4d166996af969b6cd371287d1a3e52733704727884d9b74cb7a7",
  "osx-64": "1e71054bb3ac9a076e21f7ec48acfef536f9b3f1408f371a942784bf5ef83d8a",
  "osx-arm64":
    "ec2a072f028e1a7cf20f3e2e74d5a8127cf5a5f27636375b5359811565f4e5be",
};

/**
 * Which conda platform this host is, or `undefined` where no managed install
 * is possible.
 *
 * Windows is `undefined` by intent rather than by omission: the conda-forge
 * recipe skips it, so an install action must never be offered there.
 */
export function condaSubdir(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): CondaSubdir | undefined {
  if (platform === "linux") {
    if (arch === "x64") return "linux-64";
    if (arch === "arm64") return "linux-aarch64";
  }
  if (platform === "darwin") {
    if (arch === "x64") return "osx-64";
    if (arch === "arm64") return "osx-arm64";
  }
  return undefined;
}

/** Where a platform's micromamba comes from, and what it must hash to. */
export interface MicromambaRelease {
  readonly url: string;
  readonly sha256: string;
}

export function micromambaRelease(subdir: CondaSubdir): MicromambaRelease {
  return {
    url: `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_TAG}/micromamba-${subdir}`,
    sha256: MICROMAMBA_SHA256[subdir],
  };
}
