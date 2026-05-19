/**
 * OMC: `function getReplaceableChoices`
 *
 * ```modelica
 * function getReplaceableChoices
 *   input TypeName baseClass;
 *   input TypeName parentClass;
 *   input Boolean includePartial = false;
 *   input Boolean sort = false;
 *   output String choices[:, :];
 * end getReplaceableChoices;
 * ```
 *
 * Returns the choices declared on a `replaceable` redeclaration site for
 * the given (`baseClass`, `parentClass`) pair. `baseClass` is the
 * TypeName of the replaceable's base type (e.g.
 * `Modelica.Media.Interfaces.PartialMedium`); `parentClass` is the model
 * that contains the `replaceable …` element (e.g.
 * `Modelica.Fluid.System`). Output is a 2D string matrix: each row is
 * `[choice-class, description]`.
 *
 * Useful for populating redeclare dropdowns in the parameter editor.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetReplaceableChoicesInputSchema = z.object({
  baseClass: z
    .string()
    .describe(
      "TypeName of the replaceable's base class (e.g. `Modelica.Media.Interfaces.PartialMedium`).",
    ),
  parentClass: z
    .string()
    .describe(
      "TypeName of the model containing the `replaceable …` declaration site (e.g. `Modelica.Fluid.System`).",
    ),
  includePartial: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include `partial` classes in the choices when true."),
  sort: z
    .boolean()
    .optional()
    .default(false)
    .describe("Sort the choices alphabetically when true."),
});
export type GetReplaceableChoicesInput = z.input<
  typeof GetReplaceableChoicesInputSchema
>;

export const GetReplaceableChoicesOutputSchema = z.object({
  choices: z
    .array(z.array(z.string()))
    .describe(
      "2D matrix of choices; each inner array is `[choiceClass, description]`.",
    ),
});
export type GetReplaceableChoicesOutput = z.infer<
  typeof GetReplaceableChoicesOutputSchema
>;

export const GetReplaceableChoicesDescription =
  "Return the redeclare choices declared on a `replaceable` element, as a 2D matrix of `[choiceClass, description]` rows.";

export async function getReplaceableChoices(
  ctx: CallContext,
  input: GetReplaceableChoicesInput,
): Promise<GetReplaceableChoicesOutput> {
  const includePartial = input.includePartial ?? false;
  const sort = input.sort ?? false;
  const raw = await ctx.call(
    `getReplaceableChoices(${input.baseClass}, ${input.parentClass}, ${mlBool(includePartial)}, ${mlBool(sort)})`,
  );
  const rows = expectList(parse(raw));
  const choices = rows.map((row) => expectStringList(row));
  return parseOutput(
    GetReplaceableChoicesOutputSchema,
    { choices },
    "getReplaceableChoices",
  );
}
