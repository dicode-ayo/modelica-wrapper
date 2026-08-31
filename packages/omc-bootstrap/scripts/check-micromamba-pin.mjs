// Verifies that the SHA-256 digests committed in `src/micromamba.ts` are the
// ones the pinned micromamba release actually publishes.
//
// Renovate can bump the tag but cannot recompute an asset's digest, so a bump
// arrives with the old hashes still in place. Without this check that ships as
// an installer whose every run dies at verification. `--write` refreshes the
// digests in place; a SHA-256 is always 64 characters, so the rewrite cannot
// change how the file is formatted.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIN_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "micromamba.ts",
);
const RELEASES = "https://github.com/mamba-org/micromamba-releases/releases";

const source = await readFile(PIN_FILE, "utf8");

const tag = source.match(/MICROMAMBA_TAG = "([^"]+)"/)?.[1];
if (tag === undefined) {
  console.error(`No MICROMAMBA_TAG found in ${PIN_FILE}.`);
  process.exit(1);
}

const committed = [
  ...source.matchAll(
    /"(linux-64|linux-aarch64|osx-64|osx-arm64)":\s*\n?\s*"([0-9a-f]{64})"/g,
  ),
].map(([, subdir, sha256]) => ({ subdir, sha256 }));

if (committed.length !== 4) {
  console.error(
    `Expected 4 committed digests in ${PIN_FILE}, found ${committed.length}.`,
  );
  process.exit(1);
}

const published = await Promise.all(
  committed.map(async ({ subdir, sha256 }) => {
    const url = `${RELEASES}/download/${tag}/micromamba-${subdir}.sha256`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`${url} -> ${response.status} ${response.statusText}`);
    }
    const actual = (await response.text()).trim().split(/\s+/)[0];
    return { subdir, committed: sha256, actual };
  }),
);

const stale = published.filter((p) => p.committed !== p.actual);

if (stale.length === 0) {
  console.log(`micromamba ${tag}: all 4 committed digests match.`);
  process.exit(0);
}

if (!process.argv.includes("--write")) {
  for (const { subdir, committed: was, actual } of stale) {
    console.error(`${subdir}\n  committed ${was}\n  published ${actual}`);
  }
  console.error(
    `\n${stale.length} digest(s) disagree with micromamba ${tag}. ` +
      `Refresh them with: pnpm --filter @dicode/omc-bootstrap check:pin --write`,
  );
  process.exit(1);
}

let updated = source;
for (const { committed: was, actual } of stale) {
  updated = updated.replace(was, actual);
}
await writeFile(PIN_FILE, updated);
console.log(`Refreshed ${stale.length} digest(s) for micromamba ${tag}.`);
