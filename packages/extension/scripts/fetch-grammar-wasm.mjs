#!/usr/bin/env node
/**
 * Install-time fetch for the tree-sitter Modelica grammar WASM.
 *
 * The grammar binary is NOT committed to the repo — it's an install artifact.
 * This script (wired as a `postinstall`) downloads the pinned release asset,
 * verifies its SHA-256 against the single-source-of-truth pin, and writes it to
 * `grammar/<filename>` next to its README.
 *
 * Cross-platform on purpose: uses only Node 20 built-ins (global `fetch`,
 * `node:crypto`, `node:fs`) — no bash/curl/gh — so it runs identically on
 * Windows, macOS and Linux. Paths are resolved relative to THIS file, not the
 * process cwd, so it works regardless of where pnpm invokes it from.
 *
 * Idempotent: if the target already exists and its hash matches the pin, it
 * prints "up to date" and exits 0 without touching the network. This is what
 * makes it safe to run on every install and lets offline installs work as long
 * as the file was pre-placed.
 */

import { readFile, writeFile, rm, rename, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRAMMAR_WASM_FILENAME,
  GRAMMAR_WASM_SHA256,
  GRAMMAR_WASM_URL,
  GRAMMAR_WASM_VERSION,
  checkGrammarSha256,
} from "../grammar/grammar-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const grammarDir = resolve(here, "..", "grammar");
const targetPath = join(grammarDir, GRAMMAR_WASM_FILENAME);

/** Does a regular file exist at `p`? */
async function fileExists(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  // Idempotency gate: a matching file already on disk means there's nothing to
  // do — skip the network entirely (also the path offline installs rely on).
  if (await fileExists(targetPath)) {
    const { ok, actual: have } = checkGrammarSha256(await readFile(targetPath));
    if (ok) {
      console.log(
        `[fetch-grammar-wasm] ${GRAMMAR_WASM_FILENAME} is up to date ` +
          `(${GRAMMAR_WASM_VERSION}, sha256 ${GRAMMAR_WASM_SHA256.slice(0, 12)}…).`,
      );
      return;
    }
    console.log(
      `[fetch-grammar-wasm] existing ${GRAMMAR_WASM_FILENAME} hash mismatch ` +
        `(have ${have.slice(0, 12)}…, want ${GRAMMAR_WASM_SHA256.slice(0, 12)}…) — re-downloading.`,
    );
  }

  console.log(
    `[fetch-grammar-wasm] downloading ${GRAMMAR_WASM_VERSION} grammar from ${GRAMMAR_WASM_URL}`,
  );

  let bytes;
  try {
    const res = await fetch(GRAMMAR_WASM_URL); // follows GitHub's redirect to the asset CDN
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to download the Modelica grammar WASM.\n` +
        `  URL: ${GRAMMAR_WASM_URL}\n` +
        `  cause: ${reason}\n\n` +
        `This download requires network access on first install. If you are ` +
        `installing offline, manually place the pinned ${GRAMMAR_WASM_VERSION} ` +
        `'${GRAMMAR_WASM_FILENAME}' (sha256 ${GRAMMAR_WASM_SHA256}) at:\n` +
        `  ${targetPath}\n` +
        `and re-run the install — the existing-file hash check will accept it.`,
    );
  }

  // Supply-chain gate: verify BEFORE the bytes ever land at the target path.
  const { ok, actual } = checkGrammarSha256(bytes);
  if (!ok) {
    // Verified on the in-memory buffer — a bad download never touches disk.
    throw new Error(
      `Modelica grammar WASM integrity check FAILED — refusing to write it.\n` +
        `  URL:      ${GRAMMAR_WASM_URL}\n` +
        `  expected: ${GRAMMAR_WASM_SHA256}\n` +
        `  actual:   ${actual}\n\n` +
        `Either the upstream asset changed or the download was tampered with. ` +
        `If upstream legitimately re-published, bump the pin in ` +
        `grammar/grammar-source.mjs (and grammar/README.md) together.`,
    );
  }

  await mkdir(grammarDir, { recursive: true });
  // Atomic publish: write a temp sibling, then rename into place, so a crash
  // mid-write can never leave a truncated grammar at the target path.
  const tmpPath = `${targetPath}.download`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, targetPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
  console.log(
    `[fetch-grammar-wasm] wrote ${targetPath} ` +
      `(${bytes.length} bytes, sha256 verified).`,
  );
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
