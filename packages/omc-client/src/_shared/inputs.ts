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
 * `invoke()` is the validated boundary, and an OMC alias that reached it
 * unnormalized would otherwise be dropped rather than refused — leaving a
 * function with an argument-less overload to answer a question nobody asked.
 *
 * Every field carries a generic `.describe(...)` for the MCP-generation
 * pipeline. Per-function files only override these when the OMC docs say
 * something specifically different (e.g. `loadModel.typeName` means "library
 * to load", not "class to inspect").
 */

import { z } from "zod";

import { modelicaName } from "./fields.js";

/** A required `TypeName` input. Used by isPackage, existClass, getInheritanceCount, etc. */
export const TypeNameInput = z.strictObject({
  typeName: modelicaName.describe(
    'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"). Emitted to OMC unquoted, so it must be a Modelica name and nothing else — a value carrying a bracket, a separator or a quote is refused, not escaped.',
  ),
});
export type TypeNameInput = z.input<typeof TypeNameInput>;

/**
 * A `TypeName` input with an OMC default (e.g., `getClassNames` defaults to
 * `AllLoadedClasses`, `getVersion` defaults to `OpenModelica`). Caller may omit.
 */
export const OptionalTypeNameInput = z.strictObject({
  typeName: modelicaName
    .optional()
    .describe(
      "Fully qualified Modelica TypeName, emitted to OMC unquoted and refused unless it is a Modelica name. Omit to use the OMC-side default for this function.",
    ),
});
export type OptionalTypeNameInput = z.input<typeof OptionalTypeNameInput>;

/**
 * `{ typeName, modifier }` — used by modifier readers like
 * `getComponentModifierValue`, `getElementModifierValue`. Wrappers with extra
 * fields (e.g. `setComponentModifierValue` with `expr`) extend this.
 */
export const TypeNameAndModifierInput = z.strictObject({
  typeName: modelicaName.describe(
    'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"). Emitted to OMC unquoted, so it must be a Modelica name and nothing else — a value carrying a bracket, a separator or a quote is refused, not escaped.',
  ),
  modifier: modelicaName.describe(
    "Dotted modifier path within the class (e.g. `controller.k`), emitted to OMC unquoted and refused unless it is a Modelica name.",
  ),
});
export type TypeNameAndModifierInput = z.input<typeof TypeNameAndModifierInput>;

/**
 * `{ typeName, componentName }` — used by component-targeted readers/writers
 * like `getComponentModifierNames`, `getComponentComment`. Wrappers with extra
 * fields extend this.
 */
export const TypeNameAndComponentNameInput = z.strictObject({
  typeName: modelicaName.describe(
    'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"). Emitted to OMC unquoted, so it must be a Modelica name and nothing else — a value carrying a bracket, a separator or a quote is refused, not escaped.',
  ),
  componentName: modelicaName.describe(
    "Component (variable) name within the class, emitted to OMC unquoted and refused unless it is a Modelica name.",
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
export const TypeNameAndIndexInput = z.strictObject({
  typeName: modelicaName.describe(
    'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"). Emitted to OMC unquoted, so it must be a Modelica name and nothing else — a value carrying a bracket, a separator or a quote is refused, not escaped.',
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
