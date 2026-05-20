/**
 * OMC: `function qualifyPath`
 *
 * Resolve a short type name to its fully qualified path, relative to a given
 * class scope. OMEdit uses this in the parameter editor's
 * replaceable/redeclare flow (`ElementProperties.cpp`) to qualify a short type
 * name before emitting the modifier — avoiding ambiguous short names.
 *
 * ```modelica
 * function qualifyPath
 *   input TypeName classPath;
 *   input TypeName path;
 *   output TypeName qualifiedPath;
 * end qualifyPath;
 * ```
 *
 * Both arguments are `TypeName` and are emitted **bare** (unquoted) per
 * audit.md §2.6. `classPath` is the primary class (mapped to `typeName` per the
 * package-wide TypeName-rename rule); `path` is the secondary name to qualify
 * within that scope and keeps its OMC docs name.
 *
 * Verified live on OMC 1.26.7 (Modelica loaded):
 *   - `qualifyPath(Modelica.Electrical.Analog.Basic, Resistor)`
 *       → `Modelica.Electrical.Analog.Basic.Resistor`
 * If `path` cannot be qualified in the scope, OMC returns it unchanged.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const QualifyPathInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Class scope (OMC parameter `classPath`) in which to qualify the path; emitted bare to OMC.",
    ),
  path: z
    .string()
    .describe(
      "Short or partial TypeName to resolve within the class scope; emitted bare to OMC.",
    ),
});
export type QualifyPathInput = z.input<typeof QualifyPathInputSchema>;

export const QualifyPathOutputSchema = z.object({
  qualifiedPath: z
    .string()
    .describe(
      "Fully qualified TypeName for `path` within the class scope; returned unchanged if it cannot be qualified.",
    ),
});
export type QualifyPathOutput = z.infer<typeof QualifyPathOutputSchema>;

export const QualifyPathDescription =
  "Return the fully qualified path for the given path in a class.";

export async function qualifyPath(
  ctx: CallContext,
  input: QualifyPathInput,
): Promise<QualifyPathOutput> {
  const raw = await ctx.call(`qualifyPath(${input.typeName}, ${input.path})`);
  return parseOutput(
    QualifyPathOutputSchema,
    { qualifiedPath: expectString(parse(raw)) },
    "qualifyPath",
  );
}
