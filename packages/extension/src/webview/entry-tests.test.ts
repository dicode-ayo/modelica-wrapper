import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Istanbul instruments a file no test imports with the default transform,
// which rejects the entries' Lit decorators and fails the whole coverage run.
const files = readdirSync(dirname(fileURLToPath(import.meta.url)));
const entries = files.filter((f) => f.endsWith("-entry.ts"));

describe("every webview entry is imported by its own happy-dom test", () => {
  it.each(entries)("%s has a sibling *-entry.test.ts", (entry) => {
    expect(files).toContain(entry.replace(/\.ts$/, ".test.ts"));
  });

  it("finds the entries at all", () => {
    expect(entries.length).toBeGreaterThan(0);
  });
});
