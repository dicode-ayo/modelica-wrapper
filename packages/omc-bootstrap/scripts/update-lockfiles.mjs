// Regenerates `src/lockfile.generated.ts` — the explicit package list every
// install runs.
//
//   node scripts/update-lockfiles.mjs 1.27.0
//
// Solving on the user's machine makes the installed environment a function of
// the day it was installed: the pin names OpenModelica's version, and conda-
// forge keeps moving everything underneath it. Solving here instead, once, per
// supported subdir, is what makes two installs of the same pin the same
// environment. The solve runs through the pinned micromamba, so it is the
// resolver the installer itself ships.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUBDIRS,
  micromambaUrl,
  readMicromambaPin,
} from "./micromamba-pin.mjs";

const OUT_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lockfile.generated.ts",
);

/**
 * The system facts a solve for another machine cannot read off this one. They
 * are floors rather than preferences: solving against whatever this host runs
 * would hand someone on an older system packages it cannot load. Both values
 * are the ones OpenModelica's own record declares, so a solve that stops
 * needing them means the floor moved and this has to move with it.
 */
const HOST_FLOOR = {
  "linux-64": { CONDA_OVERRIDE_GLIBC: "2.17" },
  "linux-aarch64": { CONDA_OVERRIDE_GLIBC: "2.17" },
  "osx-64": { CONDA_OVERRIDE_OSX: "11.0" },
  "osx-arm64": { CONDA_OVERRIDE_OSX: "11.0" },
};

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    "Usage: node scripts/update-lockfiles.mjs <OpenModelica version>\n" +
      "The version must match SUPPORTED_OMC.primary in @dicode/omc-client.",
  );
  process.exit(1);
}

const { tag, digests } = await readMicromambaPin();
const workDir = await mkdtemp(join(tmpdir(), "omc-lockfile-"));

try {
  const micromamba = await fetchMicromamba(workDir, tag, digests);
  const lockfiles = [];
  for (const subdir of SUBDIRS) {
    process.stderr.write(`solving ${subdir} ... `);
    const packages = solve(micromamba, workDir, subdir, version);
    process.stderr.write(`${packages.length} packages\n`);
    lockfiles.push({ subdir, text: explicitText(packages) });
  }
  await writeFile(OUT_FILE, render(version, lockfiles));
  console.log(`Wrote ${OUT_FILE} for OpenModelica ${version}.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await rm(workDir, { recursive: true, force: true });
}

/** The pinned micromamba for this host, verified against the committed digest. */
async function fetchMicromamba(workDir, tag, digests) {
  const subdir = hostSubdir();
  const expected = digests.find((d) => d.subdir === subdir)?.sha256;
  const url = micromambaUrl(tag, subdir);

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `micromamba from ${url} hashed to ${actual}, not the committed ${expected}.\n` +
        `Refresh the pin first: pnpm --filter @dicode/omc-bootstrap check:pin`,
    );
  }

  const binary = join(workDir, "micromamba");
  await writeFile(binary, bytes);
  await chmod(binary, 0o755);
  return binary;
}

function hostSubdir() {
  const subdir =
    process.platform === "linux"
      ? { x64: "linux-64", arm64: "linux-aarch64" }[process.arch]
      : process.platform === "darwin"
        ? { x64: "osx-64", arm64: "osx-arm64" }[process.arch]
        : undefined;
  if (subdir === undefined) {
    throw new Error(
      `No pinned micromamba for ${process.platform}-${process.arch}; run this on Linux or macOS.`,
    );
  }
  return subdir;
}

/**
 * What micromamba would install for `openmodelica=<version>` on `subdir`. The
 * solve is a dry run against remote repodata, so a foreign subdir resolves the
 * same as it would on that machine.
 */
function solve(micromamba, workDir, subdir, version) {
  const result = spawnSync(
    micromamba,
    [
      "create",
      "--prefix",
      join(workDir, "unused"),
      "--channel",
      "conda-forge",
      "--override-channels",
      "--platform",
      subdir,
      "--dry-run",
      "--json",
      "--yes",
      `openmodelica=${version}`,
    ],
    {
      env: {
        ...process.env,
        ...HOST_FLOOR[subdir],
        MAMBA_ROOT_PREFIX: join(workDir, "root"),
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `micromamba could not solve ${subdir}:\n${solverErrors(result)}`,
    );
  }

  const solved = JSON.parse(String(result.stdout));
  const fetched = solved.actions?.FETCH ?? [];
  if (fetched.length === 0) {
    throw new Error(`micromamba solved ${subdir} to nothing.`);
  }
  return fetched;
}

/** `--json` puts the solver's own diagnosis on stdout, and stderr stays empty. */
function solverErrors(result) {
  try {
    const { log_history: log = [] } = JSON.parse(String(result.stdout));
    return log
      .filter(({ level }) => level === "error")
      .map(({ message }) => message)
      .join("\n");
  } catch {
    return String(result.stderr).trim();
  }
}

/**
 * conda's explicit-environment format. Each URL carries the digest conda checks
 * the download against, which is what lets an install skip the solver without
 * giving up on knowing what it fetched.
 */
function explicitText(packages) {
  return [
    "@EXPLICIT",
    ...packages.map(({ url, sha256 }) => `${url}#${sha256}`),
  ].join("\n");
}

function render(version, lockfiles) {
  const entries = lockfiles
    .map(({ subdir, text }) => `  "${subdir}": \`${text}\n\`,`)
    .join("\n");

  return `/**
 * The packages an install fetches, solved once per supported subdir.
 *
 * Generated by \`scripts/update-lockfiles.mjs\`. Regenerate it rather than
 * editing it, and regenerate it whenever the OpenModelica pin moves.
 */

import type { CondaSubdir } from "./micromamba.js";

/** The OpenModelica these lockfiles install. */
export const LOCKFILE_OMC_VERSION = "${version}";

export const LOCKFILES: Readonly<Record<CondaSubdir, string>> = {
${entries}
};
`;
}
