import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/diagram-svg.
// Dev resolution stays on ./src/*.ts (top-level package.json fields); this
// config only feeds `pnpm build` / `prepublishOnly`, whose dist output the
// `publishConfig` overlay points the published package at.
export default defineConfig({
  // Single public entry — mirrors the `.` export.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // Runtime deps (incl. the workspace @dicode/omc-client) are
  // declared in `dependencies`, so tsup auto-externalizes them rather than
  // bundling them into the artifact.
});
