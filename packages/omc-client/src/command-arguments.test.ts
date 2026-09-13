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

/**
 * Fields each `_shared/inputs.ts` shape declares with a constrained atom. A
 * wrapper extending a shape still declares its own extra fields itself, so
 * membership is per field, not per file.
 */
const CONSTRAINED_SHAPE_FIELDS: Record<string, string[]> = {
  TypeNameInput: ["typeName"],
  OptionalTypeNameInput: ["typeName"],
  TypeNameAndModifierInput: ["typeName", "modifier"],
  TypeNameAndComponentNameInput: ["typeName", "componentName"],
  TypeNameAndIndexInput: ["typeName", "n"],
};

/** Atoms in `_shared/fields.ts` that are themselves built on a constrained one. */
const CONSTRAINED_FIELDS = [
  "typeNameOfConnection",
  "typeNameOfExtends",
  "extendsBase",
  "connectionAnnotation",
  "expr",
];

/**
 * Input fields a command-shaped template interpolates bare.
 *
 * A wrapper is free to assemble an argument into a local first — `const within
 * = input.within ?? ""` — so a local is resolved back to the fields its
 * initializer reads. One level is enough for every wrapper here, and a local
 * built from another local would surface as an unresolved name rather than
 * passing quietly.
 */
function bareFields(src: string): string[] {
  const fields: string[] = [];
  const locals = new Map<string, string>();
  for (const decl of src.matchAll(/\bconst (\w+)(?:: \w+)? =\s*([^;]*);/gs)) {
    const [, name, init] = decl;
    if (name !== undefined && init !== undefined) locals.set(name, init);
  }
  const push = (expr: string, viaLocal: boolean): void => {
    const direct = /^input\.(\w+)$/.exec(expr);
    if (direct?.[1] !== undefined) {
      fields.push(direct[1]);
      return;
    }
    if (viaLocal) return;
    let init = locals.get(expr);
    if (init === undefined) return;
    // A field the initializer already ran through a formatter is safe, and a
    // field it only compares against is never emitted at all.
    init = init.replace(
      /\b(?:quote|quoteList|quoteListOrFillEmpty|mlBool)\([^()]*\)/g,
      "",
    );
    const branches = init.indexOf("?");
    if (branches !== -1) init = init.slice(branches + 1);
    for (const ref of init.matchAll(/\binput\.(\w+)\b/g)) {
      if (ref[1] !== undefined) fields.push(ref[1]);
    }
  };
  for (const call of src.matchAll(/`[A-Za-z_$][\w$]*\([^`]*`/g)) {
    for (const arg of call[0].matchAll(/\$\{([^}]*)\}/g)) {
      push(arg[1]?.trim() ?? "", false);
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
  // `foo: modelicaName` and `foo: z.array(modelicaName)` both constrain `foo`.
  const declared = new RegExp(
    `\\b${field}:\\s*(?:z\\s*\\.array\\(\\s*)?(${[...CONSTRAINED, ...CONSTRAINED_FIELDS].join("|")})\\b`,
  );
  if (declared.test(src)) return true;
  // `z.number()`, `z.boolean()` and `z.enum([...])` each pin the value to a
  // form that cannot carry a bracket or a separator.
  if (new RegExp(`\\b${field}:\\s*z\\s*\\.(number|boolean|enum)\\(`).test(src))
    return true;
  // `foo,` shorthand for an atom of the same name, e.g. `expr,`
  if (
    CONSTRAINED_FIELDS.includes(field) &&
    new RegExp(`^\\s+${field},$`, "m").test(src)
  )
    return true;
  return Object.entries(CONSTRAINED_SHAPE_FIELDS).some(
    ([shape, fields]) => src.includes(shape) && fields.includes(field),
  );
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
