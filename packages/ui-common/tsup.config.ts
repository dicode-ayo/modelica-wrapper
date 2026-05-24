import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/ui-common.
// Dev resolution stays on ./src/*.ts; this config feeds `pnpm build` /
// `prepublishOnly`, and `publishConfig` repoints the published package at dist.
export default defineConfig({
  // Both public entries — mirrors the `.` and `./webawesome-setup` exports.
  entry: ["src/index.ts", "src/webawesome-setup.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // lit + @awesome.me/webawesome are in `dependencies`, so the bare
  // `@awesome.me/webawesome/.../*.css` side-effect imports stay external for
  // the consuming bundler. The one local asset — `./wa-bridge.css`, imported
  // for side effects by webawesome-setup.ts — is copied verbatim into dist via
  // esbuild's `copy` loader; esbuild rewrites the import to the emitted file so
  // the published `import "./wa-bridge-*.css"` resolves for downstream bundlers.
  loader: {
    ".css": "copy",
  },
});
