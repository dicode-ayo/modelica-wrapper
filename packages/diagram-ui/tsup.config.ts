import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/diagram-ui.
// Dev resolution stays on ./src/*.ts; this config feeds `pnpm build` /
// `prepublishOnly`, and `publishConfig` repoints the published package at dist.
export default defineConfig({
  // Single public entry — mirrors the `.` export.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // lit, @lit/context, @babylonjs/*, @awesome.me/webawesome and the workspace
  // libs are all in `dependencies`, so tsup keeps them external (the bare
  // `@awesome.me/webawesome/.../*.css` and `*.js` side-effect imports survive
  // verbatim for the consuming bundler to resolve).
});
