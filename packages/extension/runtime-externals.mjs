/**
 * Runtime dependencies esbuild leaves external (see `extensionConfig.external`
 * in esbuild.config.mjs) rather than bundling into out/extension.js — the
 * single source of truth `esbuild.config.mjs` and `scripts/package-vsix.mjs`
 * both read from, so the two can't drift apart.
 */
export const RUNTIME_EXTERNALS = ["vscode", "zeromq", "web-tree-sitter"];
