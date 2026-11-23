import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Istanbul instruments a file no test imports with the default transform,
// which rejects Lit decorators and fails the whole coverage run. Only the
// `webview` vitest project compiles them, and it collects `*-entry.test.ts`.
const webviewDir = dirname(fileURLToPath(import.meta.url));
const srcDir = dirname(webviewDir);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return e.name.endsWith(".ts") && !e.name.includes(".test.") ? [path] : [];
  });
}

const DECORATOR = /^\s*(export\s+)?@(customElement|property|state|query)\(/m;
const decorated = sourceFiles(srcDir)
  .filter((path) => DECORATOR.test(readFileSync(path, "utf8")))
  .map((path) => relative(srcDir, path));

describe("every decorated source file is imported by a happy-dom entry test", () => {
  it.each(decorated)("%s is a webview entry", (file) => {
    expect(file).toMatch(/^webview\/[^/]+-entry\.ts$/);
  });

  it.each(decorated)(
    "%s is imported by its sibling *-entry.test.ts",
    (file) => {
      const name = basename(file, ".ts");
      const test = readFileSync(join(webviewDir, `${name}.test.ts`), "utf8");
      expect(test).toContain(`"./${name}.js"`);
    },
  );

  it("finds the decorated files at all", () => {
    expect(decorated.length).toBeGreaterThan(0);
  });
});
