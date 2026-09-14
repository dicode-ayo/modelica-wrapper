/**
 * Reusable atomic Zod field schemas.
 *
 * Whole-object schemas in `_shared/inputs.ts` / `_shared/outputs.ts` cover the
 * "3+ wrappers share the same complete object shape" case (e.g.
 * `TypeNameInput`, `SuccessOutput`). This module covers a level deeper: when a
 * single `<field>: z.<type>().describe(...)` declaration appears in 3+ wrapper
 * files with identical shape (and identical or near-identical description),
 * the atomic field lives here.
 *
 * Per-function consumers import via property shorthand:
 *
 * ```ts
 * import { prettyPrint, typeNameOfConnection } from "../../_shared/fields.js";
 *
 * export const FooInputSchema = z.strictObject({
 *   typeName: typeNameOfConnection,
 *   prettyPrint,
 * });
 * ```
 *
 * If a per-function file has a meaningfully more-specific description from
 * the OMC docs, override at the use site:
 *
 * ```ts
 * expr: expr.describe("Modelica expression to bind to the modifier; empty clears the modifier."),
 * ```
 *
 * Naming convention: lowercase atomic schemas (this file) vs. PascalCase
 * whole-object schemas (`inputs.ts` / `outputs.ts`). Specialized variants of
 * a common field name carry a contextual suffix (`typeNameOfConnection`,
 * `typeNameOfExtends`).
 */

import { z } from "zod";

/**
 * Modelica name grammar, as OMC's scripting parser reads an argument emitted
 * without quotes: dot-separated segments, each an IDENT or a Q-IDENT, each
 * optionally subscripted.
 *
 * A Q-IDENT lexes as one token, so a `.` or a `)` inside one is inert and the
 * pattern admits it. A subscript admits what an index expression is made of —
 * integers, identifiers, `end`, ranges, the dimension separator and
 * arithmetic (`pins[3].p`, `ports[i]`, `a[1, 2]`, `v[1:n]`, `pins[i + 1]`).
 * None of those can carry a bracket, a quote or a separator that would end the
 * argument; a nested subscript can, so it is not admitted.
 */
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

/** One unquoted Modelica identifier, whole — no dots, no subscript. */
export const MODELICA_IDENT = new RegExp(`^${IDENT}$`);
const QIDENT = "'(?:[^'\\\\]|\\\\.)+'";
const SUBSCRIPT = "(?:\\[[A-Za-z0-9_,:\\s+*/.-]+\\])?";
const SEGMENT = `(?:${IDENT}|${QIDENT})${SUBSCRIPT}`;
const MODELICA_NAME = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`);
const NAME_BODY = `${SEGMENT}(?:\\.${SEGMENT})*`;
const RESULT_VARIABLE = new RegExp(`^(?:${NAME_BODY}|der\\(${NAME_BODY}\\))$`);

/**
 * What survives the layer past OMC. OMC builds a model by generating a
 * makefile and a compiler invocation out of `fileNamePrefix`, `cflags`,
 * `simflags` and `options`, and hands those to `/bin/sh`. Quoting that keeps a
 * value inside its OMC argument buys nothing one layer out, so the values that
 * reach it are held to the characters a filename and a flag are made of.
 */
const FILE_NAME_PREFIX = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const SHELL_FLAGS = /^[A-Za-z0-9_\-=+,:./@[\] ]*$/;

/** Bracket kind opened, keyed by the character that closes it. */
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Why `s` would leave the argument position it is interpolated into, or
 * `undefined` if it stays put.
 *
 * An annotation or modifier value is an arbitrary expression, so no pattern as
 * narrow as {@link MODELICA_NAME} fits it. What it must not do is leave the
 * argument position it is interpolated into: brackets stay balanced, and a
 * separator or comment marker that would end the argument or the call cannot
 * appear outside a string literal.
 */
export function expressionFault(s: string): string | undefined {
  let fault: string | undefined;
  const reject = (why: string): void => {
    fault ??= why;
  };
  const stack: string[] = [];
  let inString = false;
  // A Q-IDENT is one token to OMC's lexer, so a comma or bracket inside one is
  // inert and must not be read as structure.
  let inQident = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (inString || inQident) {
      if (c === "\\") i++;
      else if (inString && c === '"') inString = false;
      else if (inQident && c === "'") inQident = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "'") inQident = true;
    else if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== OPENER[c]) reject("closes a bracket it did not open");
    } else if (c === "," || c === ";") {
      if (stack.length === 0) reject("separates arguments at the top level");
    } else if (
      c === "/" &&
      (s.charAt(i + 1) === "/" || s.charAt(i + 1) === "*")
    ) {
      reject("comments out the rest of the command");
    }
  }
  if (inString) reject("leaves a string literal open");
  if (inQident) reject("leaves a quoted identifier open");
  if (stack.length > 0) reject("leaves a bracket open");
  return fault;
}

/**
 * A name OMC receives unquoted — a TypeName, a component reference, a modifier
 * path. Consumers override the description at the use site, not the pattern:
 * it is the command grammar rather than a preference.
 *
 * The pattern crosses into the field's JSON Schema, so an MCP client sees the
 * shape before it calls rather than after.
 */
export const modelicaName = z
  .string()
  .describe(
    "A Modelica name, emitted to OMC unquoted: a value carrying a bracket, a separator or a quote is refused, not escaped.",
  )
  .regex(
    MODELICA_NAME,
    'must be a Modelica name — dot-separated identifiers, each optionally subscripted (e.g. "Modelica.Blocks.Math.Gain", "pins[3].p"), or a single-quoted Q-IDENT',
  );

/**
 * A variable as it is named in a simulation result: a cref, or a cref under
 * `der(...)`, which is how OMC names a state derivative in the result file.
 * `val` and `readSimulationResult` emit these unquoted, and a plot of a
 * derivative asks for one by that name.
 */
export const resultVariable = z
  .string()
  .regex(
    RESULT_VARIABLE,
    'must be a result variable — a Modelica name, optionally wrapped in `der(...)` (e.g. "body.r[1]", "der(x)")',
  );

/**
 * {@link modelicaName} for the wrappers that also read `""` as "argument
 * omitted", so the sentinel does not have to be smuggled past the pattern.
 */
export const modelicaOrOmittedName = z.union([modelicaName, z.literal("")]);

/**
 * A raw Modelica expression OMC receives unquoted — an annotation, a modifier
 * value. No pattern describes these, so the constraint is a refinement and only
 * the description crosses into JSON Schema.
 */
export const modelicaExpr = z.string().superRefine((s, ctx) => {
  const fault = expressionFault(s);
  if (fault !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: `must be one self-contained Modelica expression; this one ${fault}`,
    });
  }
});

/**
 * The value OMC's `simulate` and `buildModelFMU` declare as the default of
 * every string parameter. A wrapper reads it as "argument not set" and derives
 * no filename or flag from it, so it reaches no makefile and the atoms let it
 * through.
 */
const omcDefault = z.literal("<default>");

/**
 * A prefix for the files OMC generates while building a model. It names an
 * output file and nothing else, so it is held to what a filename is made of
 * and a value carrying more is refused rather than escaped.
 */
export const fileNamePrefix = z.union([
  z
    .string()
    .regex(
      FILE_NAME_PREFIX,
      'must be a filename — a letter, digit or underscore followed by any of those plus "." and "-"; OMC pastes it into a generated makefile, so a value carrying anything else is refused, not escaped',
    ),
  omcDefault,
]);

/**
 * Flags OMC forwards to the C compiler or the simulation executable —
 * `cflags`, `simflags`, `options`. The set covers what a flag is made of and
 * stops short of the characters that would end the shell word or start a
 * command of their own. Brackets stay in: `-override=x[1]=2` names an array
 * element.
 */
export const shellFlags = z.union([
  z
    .string()
    .regex(
      SHELL_FLAGS,
      "must be flag-shaped — letters, digits, space and any of _ - = + , : . / @ [ ]; OMC pastes it into a generated makefile, so a value carrying more is refused, not escaped",
    ),
  omcDefault,
]);

/**
 * A {@link fileNamePrefix} derived from a Modelica class name.
 *
 * A class name segment may be a Q-IDENT, which carries anything but a quote or
 * a backslash, so `'a; rm -rf x'` is a name {@link modelicaName} admits and
 * would reach the shell verbatim. Collapsing every character outside the
 * identifier set to `_` yields a prefix {@link fileNamePrefix} accepts. The
 * dotted path is kept whole so two classes sharing a leaf name do not share an
 * output directory.
 *
 * Names differing only outside the identifier set collapse onto one prefix and
 * do share one.
 */
export function classNameToFilePrefix(typeName: string): string {
  return typeName.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * `prettyPrint` flag — used by JSON-emitting calls (`getModelInstance`,
 * `getModelInstanceAnnotation`, `modifierToJSON`).
 */
export const prettyPrint = z
  .boolean()
  .optional()
  .default(false)
  .describe("Indent the JSON output for human readability when true.");

/**
 * `requireExactVersion` flag — used by every load-* call (`loadFile`,
 * `loadFiles`, `loadModel`, `loadString`).
 */
export const requireExactVersion = z
  .boolean()
  .optional()
  .default(false)
  .describe("Require exact version matches when resolving library references.");

/**
 * `typeName` specialized for connection-targeted calls (`getNthConnection`,
 * `getNthConnectionAnnotation`, `deleteConnection`, `updateConnection`).
 */
export const typeNameOfConnection = modelicaName.describe(
  "Class containing the connection; emitted to OMC unquoted.",
);

/**
 * `typeName` specialized for `extends`-clause-targeted calls
 * (`getExtendsModifierNames`, `getExtendsModifierValue`,
 * `setExtendsModifierValue`).
 */
export const typeNameOfExtends = modelicaName.describe(
  "Class containing the `extends` clause; emitted to OMC unquoted.",
);

/**
 * Optional `Line(...)` annotation argument used by connection / transition
 * mutators (`addConnection`, `addTransition`, `updateConnection`).
 */
export const connectionAnnotation = modelicaExpr
  .optional()
  .default("")
  .describe(
    'Raw Modelica `Line(...)` annotation (no `annotate=` prefix); "" yields the default Line. Emitted to OMC unquoted, so it must be one self-contained expression.',
  );

/**
 * `extendsBase` — TypeName of the base class on the `extends` clause being
 * inspected or mutated. Used by `getExtendsModifierNames`,
 * `getExtendsModifierValue`, `setExtendsModifierValue`. Setters override
 * with "...to mutate." at the use site.
 */
export const extendsBase = modelicaName.describe(
  "TypeName of the base class on the `extends` clause to inspect; emitted to OMC unquoted.",
);

/**
 * `expr` — raw Modelica expression for a modifier value, wrapped in
 * `$Code(=…)` before being sent to OMC; empty string removes the modifier.
 * Used by `setComponentModifierValue`, `setExtendsModifierValue`,
 * `setElementModifierValue`. Variants override at the use site for slightly
 * different OMC docs phrasing.
 */
export const expr = modelicaExpr.describe(
  "Raw Modelica expression for the new modifier value (wrapped in `$Code(=…)` for OMC); empty removes the modifier. Emitted unquoted, so it must be one self-contained expression.",
);
