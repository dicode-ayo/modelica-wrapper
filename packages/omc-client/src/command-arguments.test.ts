/**
 * A wrapper builds its OMC command by interpolating arguments into a template
 * string, so an argument carrying a `)` or a `;` closes the call and starts
 * another (issue #656). `quote`, `bareName` and `bareExpr` each close that for
 * one argument kind, but nothing stops the next wrapper from interpolating an
 * input field raw — which is how all 155 of them came to.
 *
 * So the sources are read back: no command template names an input field
 * except through a formatter. Every template shaped like a call is scanned,
 * not only the ones inline in `ctx.call(`, because a wrapper is free to build
 * its command into a variable first — four of them do.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "api");

const FORMATTERS = [
  "quote",
  "quoteList",
  "quoteListOrFillEmpty",
  "mlBool",
  "bareName",
  "bareExpr",
];

/** `${...}` substitutions inside every command-shaped template in `src`. */
function callArguments(src: string): string[] {
  const args: string[] = [];
  for (const call of src.matchAll(/`[A-Za-z_$][\w$]*\([^`]*`/g)) {
    for (const arg of call[0].matchAll(/\$\{([^}]*)\}/g)) {
      const expr = arg[1]?.trim();
      if (expr !== undefined) args.push(expr);
    }
  }
  return args;
}

async function wrapperSources(): Promise<[string, string][]> {
  const entries = await readdir(API_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter(
      (e) =>
        e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"),
    )
    .map((e) => join(e.parentPath, e.name));
  return Promise.all(
    files.map(async (f): Promise<[string, string]> => [
      f,
      await readFile(f, "utf8"),
    ]),
  );
}

describe("every OMC command argument", () => {
  it("passes an input field through a formatter before interpolating it", async () => {
    const raw: string[] = [];
    for (const [file, src] of await wrapperSources()) {
      for (const expr of callArguments(src)) {
        if (!expr.startsWith("input.")) continue;
        if (FORMATTERS.some((f) => expr.startsWith(`${f}(`))) continue;
        raw.push(`${file}: \${${expr}}`);
      }
    }
    expect(raw).toEqual([]);
  });
});
