// The micromamba pin as committed in `src/micromamba.ts`, for the scripts that
// verify it and the one that runs the pinned binary to solve a lockfile.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PIN_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "micromamba.ts",
);

export const SUBDIRS = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64"];

const DIGEST = new RegExp(
  `"(${SUBDIRS.join("|")})":\\s*\\n?\\s*"([0-9a-f]{64})"`,
  "g",
);

/**
 * The committed tag and per-subdir digests. Reading the TypeScript rather than
 * importing it keeps these scripts runnable with plain `node`, no build step.
 */
export async function readMicromambaPin() {
  const source = await readFile(PIN_FILE, "utf8");

  const tag = source.match(/MICROMAMBA_TAG = "([^"]+)"/)?.[1];
  if (tag === undefined) {
    throw new Error(`No MICROMAMBA_TAG found in ${PIN_FILE}.`);
  }

  const digests = [...source.matchAll(DIGEST)].map(([, subdir, sha256]) => ({
    subdir,
    sha256,
  }));

  if (digests.length !== SUBDIRS.length) {
    throw new Error(
      `Expected ${SUBDIRS.length} committed digests in ${PIN_FILE}, found ${digests.length}.`,
    );
  }

  return { source, tag, digests };
}

export function micromambaUrl(tag, subdir) {
  return `https://github.com/mamba-org/micromamba-releases/releases/download/${tag}/micromamba-${subdir}`;
}
