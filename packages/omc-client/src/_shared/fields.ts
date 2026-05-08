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
 * export const FooInputSchema = z.object({
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
  .describe(
    "Require exact version matches when resolving library references.",
  );

/**
 * `typeName` specialized for connection-targeted calls (`getNthConnection`,
 * `getNthConnectionAnnotation`, `deleteConnection`, `updateConnection`).
 */
export const typeNameOfConnection = z
  .string()
  .describe("Class containing the connection.");

/**
 * `typeName` specialized for `extends`-clause-targeted calls
 * (`getExtendsModifierNames`, `getExtendsModifierValue`,
 * `setExtendsModifierValue`).
 */
export const typeNameOfExtends = z
  .string()
  .describe("Class containing the `extends` clause.");

/**
 * Optional `Line(...)` annotation argument used by connection / transition
 * mutators (`addConnection`, `addTransition`, `updateConnection`).
 */
export const connectionAnnotation = z
  .string()
  .optional()
  .default("")
  .describe(
    'Raw Modelica `Line(...)` annotation (no `annotate=` prefix); "" yields the default Line.',
  );

/**
 * `extendsBase` — TypeName of the base class on the `extends` clause being
 * inspected or mutated. Used by `getExtendsModifierNames`,
 * `getExtendsModifierValue`, `setExtendsModifierValue`. Setters override
 * with "...to mutate." at the use site.
 */
export const extendsBase = z
  .string()
  .describe(
    "TypeName of the base class on the `extends` clause to inspect.",
  );

/**
 * `expr` — raw Modelica expression for a modifier value, wrapped in
 * `$Code(=…)` before being sent to OMC; empty string removes the modifier.
 * Used by `setComponentModifierValue`, `setExtendsModifierValue`,
 * `setElementModifierValue`. Variants override at the use site for slightly
 * different OMC docs phrasing.
 */
export const expr = z
  .string()
  .describe(
    "Raw Modelica expression for the new modifier value (wrapped in `$Code(=…)` for OMC); empty removes the modifier.",
  );
