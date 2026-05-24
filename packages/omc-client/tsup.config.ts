import { defineConfig } from "tsup";

// Builds the publishable artifact for @modelica-wrapper/omc-client.
// Dev resolution stays on ./src/*.ts; this config feeds `pnpm build` /
// `prepublishOnly`, and `publishConfig` repoints the published package at dist.
//
// The package exposes three export shapes that must all keep resolving once
// published:
//   "."        -> src/index.ts
//   "./eval"   -> src/eval/index.ts
//   "./api/*"  -> src/api/*   (e.g. ./api/browsing -> api/browsing/index,
//                              ./api/diagram/index.js -> api/diagram/index)
// To make `./api/*` resolve in dist exactly as it does in src, every non-test
// .ts file under src/api is its own entry. tsup preserves the src directory
// layout under dist when entries share the src/ base, so the on-disk shape of
// dist/api mirrors src/api one-to-one.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/eval/index.ts",
    "src/api/**/*.ts",
    // Tests and the vite asset shim are not part of the published surface.
    "!src/api/**/*.test.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // zeromq + zod are in `dependencies`, so tsup keeps them external rather than
  // bundling them into the artifact.
});
