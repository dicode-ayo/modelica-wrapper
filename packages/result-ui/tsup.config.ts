import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/result-ui.
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
  // lit, echarts and the workspace @dicode/ui-common are in
  // `dependencies`, so tsup keeps them external rather than bundling.
});
