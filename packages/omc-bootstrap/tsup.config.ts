import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/omc-bootstrap.
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
});
