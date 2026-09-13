/**
 * A wrapper builds its OMC command by interpolating arguments into a template
 * string, so an argument carrying a `)` or a `;` closes the call and starts
 * another (issue #656). What stops it is the field's schema: `modelicaName`
 * and `modelicaExpr` refuse a value that would not stay inside its argument,
 * and every call is parsed against the schema on its way through `invoke`.
 *
 * Nothing in a wrapper ties the two together — the template is one region of
 * the file and the schema is another, and a field declared `z.string()` still
 * compiles. So the sources are read back: a field a command emits unquoted is
 * declared with a constrained atom.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "api");

/** Atoms that carry a grammar. A field declared any other way carries none. */
const CONSTRAINED = ["modelicaName", "modelicaExpr", "modelicaOrOmittedName"];

/** Field-bearing atoms from `_shared/inputs.ts`, whose fields are constrained. */
const CONSTRAINED_SHAPES = [
  "TypeNameInput",
  "OptionalTypeNameInput",
  "TypeNameAndModifierInput",
  "TypeNameAndComponentNameInput",
  "TypeNameAndIndexInput",
];

/** Atoms in `_shared/fields.ts` that are themselves built on a constrained one. */
const CONSTRAINED_FIELDS = [
  "typeNameOfConnection",
  "typeNameOfExtends",
  "extendsBase",
  "connectionAnnotation",
  "expr",
];

/** `input.<field>` interpolated bare into a command-shaped template. */
function bareFields(src: string): string[] {
  const fields: string[] = [];
  for (const call of src.matchAll(/`[A-Za-z_$][\w$]*\([^`]*`/g)) {
    for (const arg of call[0].matchAll(/\$\{([^}]*)\}/g)) {
      const expr = arg[1]?.trim() ?? "";
      const m = /^input\.(\w+)$/.exec(expr);
      if (m?.[1] !== undefined) fields.push(m[1]);
    }
  }
  return fields;
}

/**
 * True when `field` is declared through something that carries a grammar.
 *
 * `z.number()` counts: a number cannot produce a bracket or a separator, so it
 * stays inside its argument whatever its value.
 */
function isConstrained(src: string, field: string): boolean {
  const declared = new RegExp(
    `\\b${field}:\\s*(${[...CONSTRAINED, ...CONSTRAINED_FIELDS].join("|")})\\b`,
  );
  if (declared.test(src)) return true;
  if (new RegExp(`\\b${field}:\\s*z\\s*\\.number\\(\\)`).test(src)) return true;
  // `foo,` shorthand for an atom of the same name, e.g. `expr,`
  if (
    CONSTRAINED_FIELDS.includes(field) &&
    new RegExp(`^\\s+${field},$`, "m").test(src)
  )
    return true;
  return CONSTRAINED_SHAPES.some((shape) => src.includes(shape));
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

describe("a field a command emits unquoted", () => {
  it("is declared with an atom that constrains it", async () => {
    const unconstrained: string[] = [];
    let checked = 0;
    for (const [file, src] of await wrapperSources()) {
      for (const field of bareFields(src)) {
        checked += 1;
        if (!isConstrained(src, field)) unconstrained.push(`${file}: ${field}`);
      }
    }

    expect(unconstrained).toEqual([]);
    // A regex that silently stopped matching would pass the assertion above
    // while checking nothing.
    expect(checked).toBeGreaterThan(150);
  });
});
