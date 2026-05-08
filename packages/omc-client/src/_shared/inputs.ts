/**
 * Reusable input atoms.
 *
 * Most OMC scripting calls take a class identifier (`TypeName` in Modelica
 * terms). The OMC docs use varying parameter aliases (`cl`, `class_`,
 * `name`, `pack`, `className`); we normalize all of them to `typeName` so
 * the client API is uniform.
 *
 * Composite shapes used by 3+ wrapper files are exposed here too. Files with
 * extra fields can `.extend(...)` these (e.g. `TypeNameAndModifierInput.extend({
 * expr: z.string() })`).
 *
 * Every field carries a generic `.describe(...)` for the MCP-generation
 * pipeline. Per-function files only override these when the OMC docs say
 * something specifically different (e.g. `loadModel.typeName` means "library
 * to load", not "class to inspect").
 */

import { z } from "zod";

/** A required `TypeName` input. Used by isPackage, existClass, getInheritanceCount, etc. */
export const TypeNameInput = z.object({
  typeName: z
    .string()
    .describe(
      'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"); emitted bare to OMC.',
    ),
});
export type TypeNameInput = z.input<typeof TypeNameInput>;

/**
 * A `TypeName` input with an OMC default (e.g., `getClassNames` defaults to
 * `AllLoadedClasses`, `getVersion` defaults to `OpenModelica`). Caller may omit.
 */
export const OptionalTypeNameInput = z.object({
  typeName: z
    .string()
    .optional()
    .describe(
      "Fully qualified Modelica TypeName; emitted bare to OMC. Omit to use the OMC-side default for this function.",
    ),
});
export type OptionalTypeNameInput = z.input<typeof OptionalTypeNameInput>;

/**
 * `{ typeName, modifier }` — used by modifier readers like
 * `getComponentModifierValue`, `getElementModifierValue`. Wrappers with extra
 * fields (e.g. `setComponentModifierValue` with `expr`) extend this.
 */
export const TypeNameAndModifierInput = z.object({
  typeName: z
    .string()
    .describe(
      'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"); emitted bare to OMC.',
    ),
  modifier: z
    .string()
    .describe(
      "Dotted modifier path within the class (e.g. `controller.k`); emitted bare to OMC.",
    ),
});
export type TypeNameAndModifierInput = z.input<typeof TypeNameAndModifierInput>;

/**
 * `{ typeName, componentName }` — used by component-targeted readers/writers
 * like `getComponentModifierNames`, `getComponentComment`. Wrappers with extra
 * fields extend this.
 */
export const TypeNameAndComponentNameInput = z.object({
  typeName: z
    .string()
    .describe(
      'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"); emitted bare to OMC.',
    ),
  componentName: z
    .string()
    .describe(
      "Component (variable) name within the class; emitted bare to OMC.",
    ),
});
export type TypeNameAndComponentNameInput = z.input<
  typeof TypeNameAndComponentNameInput
>;

/**
 * `{ typeName, n }` — used by Nth-* getters like `getNthConnector`,
 * `getNthInheritedClassDiagramMapAnnotation`. The OMC parameter is `Integer n`;
 * we expose it as `n` to match (note: `getNthConnection*` use `index` per OMC
 * docs and stay distinct).
 */
export const TypeNameAndIndexInput = z.object({
  typeName: z
    .string()
    .describe(
      'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"); emitted bare to OMC.',
    ),
  n: z
    .number()
    .int()
    .positive()
    .describe(
      "1-based index into the OMC list (Modelica indices start at 1, not 0).",
    ),
});
export type TypeNameAndIndexInput = z.input<typeof TypeNameAndIndexInput>;
