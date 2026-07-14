import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * happy-dom is the default environment: `@tiptap/html`'s serializer and the Lit
 * component both need a DOM, and the golden round-trip test mounts nothing but
 * still parses HTML through ProseMirror.
 */
export default defineConfig({
  test: {
    root: projectRoot,
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    testTimeout: 10_000,
  },
});
