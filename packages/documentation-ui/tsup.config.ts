import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/documentation-ui.
// Dev resolution stays on ./src/*.ts; this config feeds `pnpm build` /
// `prepublishOnly`, and `publishConfig` repoints the published package at dist.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // lit and the @tiptap/* packages are in `dependencies`, so tsup keeps them
  // external rather than bundling.
});
