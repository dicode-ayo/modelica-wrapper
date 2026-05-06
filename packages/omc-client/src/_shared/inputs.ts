/**
 * Reusable input atoms.
 *
 * Most OMC scripting calls take a class identifier (`TypeName` in Modelica
 * terms). The OMC docs use varying parameter aliases (`cl`, `class_`,
 * `name`, `pack`, `className`); we normalize all of them to `typeName` so
 * the client API is uniform.
 */

import { z } from "zod";

/** A required `TypeName` input. Used by isPackage, existClass, getInheritanceCount, etc. */
export const TypeNameInput = z.object({
  typeName: z.string(),
});
export type TypeNameInput = z.input<typeof TypeNameInput>;

/**
 * A `TypeName` input with an OMC default (e.g., `getClassNames` defaults to
 * `AllLoadedClasses`, `getVersion` defaults to `OpenModelica`). Caller may omit.
 */
export const OptionalTypeNameInput = z.object({
  typeName: z.string().optional(),
});
export type OptionalTypeNameInput = z.input<typeof OptionalTypeNameInput>;
