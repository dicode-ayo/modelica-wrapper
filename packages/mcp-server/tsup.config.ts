import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/modelica-mcp. Dev resolution
// stays on ./src/*.ts (top-level package.json fields); this config feeds
// `pnpm build` / `prepublishOnly`, whose dist output the `publishConfig`
// overlay points the published package at.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
