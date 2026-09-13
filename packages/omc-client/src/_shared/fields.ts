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

import { MODELICA_NAME, expressionFault } from "./format.js";

/**
 * A name OMC receives unquoted — a TypeName, a component reference, a modifier
 * path. Consumers override the description at the use site; the constraint is
 * not theirs to override, because it is the command grammar, not a preference.
 *
 * The pattern reaches an MCP client as the field's JSON-Schema `pattern`, so a
 * model sees the shape before it calls rather than after. It is the same
 * `RegExp` `bareName` enforces when the command is built: this one is the
 * early, attributable failure, that one is the control.
 */
export const modelicaName = z
  .string()
  .regex(
    MODELICA_NAME,
    'must be a Modelica name — dot-separated identifiers, each optionally subscripted (e.g. "Modelica.Blocks.Math.Gain", "pins[3].p"), or a single-quoted Q-IDENT',
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
