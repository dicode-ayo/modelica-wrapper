import { defineConfig } from "tsup";

// Builds the publishable artifact for @dicode/modelica-mcp. Dev resolution
// stays on ./src/*.ts (top-level package.json fields); this config feeds
// `pnpm build` / `prepublishOnly`, whose dist output the `publishConfig`
// overlay points the published package at.
//
// The `modelica-mcp` bin bundles the workspace packages it imports, because
// their dev entry points are TypeScript that `node` cannot load from the repo.
// `zeromq` is a native addon and cannot be bundled, so it stays external and
// is a direct dependency of this package for the bundled omc-client code to
// resolve it.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    // The bin config writes into the same directory concurrently.
    clean: ["!cli.js", "!cli.js.map"],
    outDir: "dist",
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    sourcemap: true,
    outDir: "dist",
    noExternal: [/^@dicode\//],
    external: ["zeromq"],
  },
]);
