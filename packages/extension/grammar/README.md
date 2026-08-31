# tree-sitter Modelica grammar (fetched on install)

`tree-sitter-modelica.wasm` is the prebuilt WebAssembly grammar used by the
language front-end (`src/language/parse.ts`) via
[`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter).

**It is not committed to the repo.** It is fetched on `pnpm install` by the
extension's `postinstall` hook (`scripts/fetch-grammar-wasm.mjs`), written here,
and gitignored (`packages/extension/grammar/*.wasm`). Only this README and
`grammar-source.mjs` are tracked.

## Provenance

The pin lives in **one place** — [`grammar-source.mjs`](./grammar-source.mjs) —
which both the fetch script and `esbuild.config.mjs` import:

- Source: [`OpenModelica/tree-sitter-modelica`](https://github.com/OpenModelica/tree-sitter-modelica)
- Release: **v0.2.2** (published 2025-07-04), Modelica 3.5 grammar.
- Asset: `tree-sitter-modelica.wasm` (a *prebuilt* GitHub release asset, not a
  local build — `web-tree-sitter` runs the grammar as WASM in-process, so there
  is no per-platform native rebuild).
- SHA-256: `fb9e1f0c33288fc301f50bff88bad28ebf2f79365b23482855a1a9e756c78e56`

> **Verified twice.** The fetch script hashes the download and **refuses to
> write** a mismatching file (supply-chain gate); `esbuild.config.mjs`'s
> `copyWasm` plugin re-hashes it before copying into `out/` and **fails the
> build** on mismatch. Both check the SHA from `grammar-source.mjs`.

## How to refresh / pin a new version

1. Edit [`grammar-source.mjs`](./grammar-source.mjs): bump `GRAMMAR_WASM_VERSION`
   and `GRAMMAR_WASM_SHA256` together (the URL is derived from the version).
2. Update the version + SHA-256 in this README to match.
3. Delete the stale local file and re-fetch:

   ```sh
   rm -f packages/extension/grammar/tree-sitter-modelica.wasm
   node packages/extension/scripts/fetch-grammar-wasm.mjs
   ```

   (or just `pnpm install` again — the hash mismatch triggers a re-download).
4. Re-run the extension's tests (`pnpm --filter modelica-wrapper test`) — the
   `cursor.ts` fixtures parse real Modelica source, so an incompatible grammar
   fails the suite.

To find the SHA of a new asset without committing it, download it and run
`shasum -a 256` / `sha256sum`, or let the fetch script's mismatch error report
the `actual:` hash.

## Offline / air-gapped installs

The fetch needs network on first install. For an offline install, manually place
the pinned `tree-sitter-modelica.wasm` at this path **before** running
`pnpm install`. The script's existing-file hash check accepts a pre-placed file
that matches the pin and skips the download entirely (idempotent).

## Bundling

`esbuild.config.mjs` copies this file (and the `web-tree-sitter` runtime
`web-tree-sitter.wasm`) into `out/` on build. At runtime `parse.ts` resolves both by
absolute path from the extension install directory. If the file is missing at
build time, the build errors with a "run `pnpm install`" message.
