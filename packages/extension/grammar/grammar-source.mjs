/**
 * Single source of truth for the pinned tree-sitter Modelica grammar WASM.
 *
 * The grammar binary is no longer committed to the repo — it is fetched from
 * the upstream GitHub release on install (see `scripts/fetch-grammar-wasm.mjs`)
 * and hash-verified against {@link GRAMMAR_WASM_SHA256}. The same SHA gates the
 * build-time copy in `esbuild.config.mjs`, which imports it from here so the
 * pin lives in exactly ONE place.
 *
 * To pin a new upstream version, bump {@link GRAMMAR_WASM_VERSION} and
 * {@link GRAMMAR_WASM_SHA256} together, then update `grammar/README.md`.
 *
 * Provenance: OpenModelica/tree-sitter-modelica, prebuilt release asset.
 * https://github.com/OpenModelica/tree-sitter-modelica/releases
 */

import { createHash } from "node:crypto";

/** Upstream release tag the pinned WASM comes from. */
export const GRAMMAR_WASM_VERSION = "v0.2.2";

/** Release asset filename (also the on-disk name under `grammar/`). */
export const GRAMMAR_WASM_FILENAME = "tree-sitter-modelica.wasm";

/**
 * Expected SHA-256 of the grammar WASM — the supply-chain invariant. Both the
 * install-time fetch and the build-time copy verify the bytes against this; a
 * tampered or wrong-version binary can't ship silently.
 */
export const GRAMMAR_WASM_SHA256 =
  "fb9e1f0c33288fc301f50bff88bad28ebf2f79365b23482855a1a9e756c78e56";

/** Direct download URL for the pinned release asset (GitHub redirects; `fetch` follows). */
export const GRAMMAR_WASM_URL = `https://github.com/OpenModelica/tree-sitter-modelica/releases/download/${GRAMMAR_WASM_VERSION}/${GRAMMAR_WASM_FILENAME}`;

/** SHA-256 of a buffer as a lowercase hex string. */
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify `buf` against the pinned {@link GRAMMAR_WASM_SHA256}. Returns the
 * computed hash alongside the verdict so callers can report the mismatch.
 * Both supply-chain gates — the install-time fetch (`fetch-grammar-wasm.mjs`)
 * and the build-time copy (`esbuild.config.mjs`) — share this one check, so the
 * two can never drift apart.
 */
export function checkGrammarSha256(buf) {
  const actual = sha256(buf);
  return { ok: actual === GRAMMAR_WASM_SHA256, actual };
}
