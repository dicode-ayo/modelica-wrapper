# Vendored tree-sitter Modelica grammar

`tree-sitter-modelica.wasm` is the prebuilt WebAssembly grammar used by the
language front-end (`src/language/parse.ts`) via
[`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter).

## Provenance

- Source: [`OpenModelica/tree-sitter-modelica`](https://github.com/OpenModelica/tree-sitter-modelica)
- Release: **v0.2.2** (published 2025-07-04), Modelica 3.5 grammar.
- Asset: `tree-sitter-modelica.wasm` (downloaded from the GitHub release).
- SHA-256: `fb9e1f0c33288fc301f50bff88bad28ebf2f79365b23482855a1a9e756c78e56`

This is a *prebuilt* release asset, not a local build — there is no native
toolchain rebuild per platform because `web-tree-sitter` runs the grammar as
WASM in-process in the extension host.

> **Enforced at build time.** `esbuild.config.mjs`'s `copyWasm` plugin hashes
> this file before copying it into `out/` and **fails the build** if it doesn't
> match `GRAMMAR_WASM_SHA256` (kept equal to the SHA above). A tampered or
> wrong-version binary can't ship silently.

## How to update

```sh
gh release download <tag> \
  --repo OpenModelica/tree-sitter-modelica \
  --pattern tree-sitter-modelica.wasm \
  --dir packages/extension/grammar --clobber
```

Then bump the release tag + SHA-256 above **and** `GRAMMAR_WASM_SHA256` in
`esbuild.config.mjs` (they must stay equal or the build fails), and re-run the
extension's tests (`pnpm --filter modelica-wrapper test`) — the `cursor.ts`
fixtures parse real Modelica source, so an incompatible grammar fails the suite.

## Bundling

`esbuild.config.mjs` copies this file (and the `web-tree-sitter` runtime
`tree-sitter.wasm`) into `out/` on build. At runtime `parse.ts` resolves both
by absolute path from the extension install directory.
