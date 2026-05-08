/**
 * Reusable output atoms.
 *
 * Many OMC functions share trivial output shapes — every mutation returns
 * `{ success: boolean }`, every class predicate returns `{ b: boolean }`,
 * etc. The output field names are kept verbatim from the OMC docs (per
 * audit.md §2.4), which is why `BooleanBOutput` keeps the field `b` rather
 * than renaming to `result` or `success`.
 *
 * Every field carries a generic `.describe(...)` for the MCP-generation
 * pipeline. Per-function files only override these when the OMC docs say
 * something more specific.
 */

import { z } from "zod";

/**
 * `{ success: boolean }` — used by every mutation wrapper (setters, deleters,
 * loaders, builders). OMC's docs name varies (`success`, `bool`, `result`);
 * this shape covers the dominant case where the docs say `output Boolean success`.
 */
export const SuccessOutput = z.object({
  success: z
    .boolean()
    .describe("True if the OMC operation completed without error."),
});
export type SuccessOutput = z.infer<typeof SuccessOutput>;

/**
 * `{ b: boolean }` — used by every class predicate (`isModel`, `isPackage`,
 * `isClass`, `existClass`, …). The field name `b` matches OMC's literal
 * `output Boolean b;` — keeping it preserves the audit convention.
 */
export const BooleanBOutput = z.object({
  b: z
    .boolean()
    .describe(
      "True if the predicate matches; field name `b` is OMC verbatim (predicate output).",
    ),
});
export type BooleanBOutput = z.infer<typeof BooleanBOutput>;

/**
 * `{ result: string }` — used by string-returning functions whose OMC output
 * is named `result` (e.g. `checkModel`, `getModelInstance`,
 * `getModelInstanceAnnotation`). Other string outputs that OMC names
 * differently (e.g. `modifierToJSON` → `json`) keep their per-function shape.
 */
export const StringResultOutput = z.object({
  result: z
    .string()
    .describe("Raw string returned by OMC; field name `result` is OMC verbatim."),
});
export type StringResultOutput = z.infer<typeof StringResultOutput>;

/**
 * `{ value: string }` — used by modifier-value readers
 * (`getComponentModifierValue`, `getElementModifierValue`, `getParameterValue`,
 * etc.) where OMC's output is named `value`.
 */
export const StringValueOutput = z.object({
  value: z
    .string()
    .describe(
      "Modifier or parameter value as a Modelica expression string; field name `value` is OMC verbatim.",
    ),
});
export type StringValueOutput = z.infer<typeof StringValueOutput>;
