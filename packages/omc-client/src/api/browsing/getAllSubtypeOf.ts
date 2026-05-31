/**
 * OMC: `function getAllSubtypeOf`
 *
 * Returns the list of all loaded classes that extend from the given class
 * (`className`), starting the lookup under `parentClass`. This is the inverse
 * query to `extendsFrom` — useful for diagram-UI palette filtering. Unlike
 * `extendsFrom`, this query IS transitive (a grandchild of `className`
 * appears in the result).
 *
 * NOTE on OMC 1.26.7 behaviour: the result *includes the class itself*, and
 * names come back qualified relative to `parentClass` (so they are
 * fully-qualified only when `parentClass` is omitted / `AllLoadedClasses`).
 * Verified against OMC 1.26.7.
 *
 * ```modelica
 * function getAllSubtypeOf
 *   input TypeName className;
 *   input TypeName parentClass = $Code(AllLoadedClasses);
 *   input Boolean qualified = false "Not implemented";
 *   input Boolean includePartial = false;
 *   input Boolean sort = false;
 *   output TypeName classNames[:];
 * end getAllSubtypeOf;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAllSubtypeOfInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Fully qualified TypeName of the base class to find subtypes of (OMC parameter `className`); emitted bare to OMC.",
    ),
  parentClass: z
    .string()
    .optional()
    .describe(
      "TypeName under which the lookup should start. Omit to search all loaded classes (OMC default `AllLoadedClasses`).",
    ),
  qualified: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "OMC parameter `qualified` (marked 'Not implemented' in the OMC docs).",
    ),
  includePartial: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include `partial` classes in the result when true."),
  sort: z
    .boolean()
    .optional()
    .default(false)
    .describe("Sort the result alphabetically when true."),
});
export type GetAllSubtypeOfInput = z.input<typeof GetAllSubtypeOfInputSchema>;

export const GetAllSubtypeOfOutputSchema = z.object({
  classNames: z
    .array(z.string())
    .describe(
      "Fully qualified TypeNames of all loaded classes that extend from the given class.",
    ),
});
export type GetAllSubtypeOfOutput = z.infer<typeof GetAllSubtypeOfOutputSchema>;

export const GetAllSubtypeOfDescription =
  "Return the list of all loaded classes that extend from the given class.";

export async function getAllSubtypeOf(
  ctx: CallContext,
  input: GetAllSubtypeOfInput,
): Promise<GetAllSubtypeOfOutput> {
  const parentClass = input.parentClass ?? "AllLoadedClasses";
  const qualified = input.qualified ?? false;
  const includePartial = input.includePartial ?? false;
  const sort = input.sort ?? false;
  const raw = await ctx.call(
    `getAllSubtypeOf(${input.typeName}, ${parentClass}, ${mlBool(qualified)}, ${mlBool(includePartial)}, ${mlBool(sort)})`,
  );
  return parseOutput(
    GetAllSubtypeOfOutputSchema,
    { classNames: expectStringList(parse(raw)) },
    "getAllSubtypeOf",
  );
}
