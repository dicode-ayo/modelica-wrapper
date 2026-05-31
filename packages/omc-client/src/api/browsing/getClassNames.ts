/**
 * OMC: `function getClassNames`
 *
 * Returns the list of class names defined inside `class_` (defaulting to
 * `AllLoadedClasses`), with flags to walk recursively, qualify the names, sort
 * them, include built-ins, expose protected classes, and include constants.
 *
 * ```modelica
 * function getClassNames
 *   input TypeName class_ = $Code(AllLoadedClasses);
 *   input Boolean recursive = false;
 *   input Boolean qualified = false;
 *   input Boolean sort = false;
 *   input Boolean builtin = false;
 *   input Boolean showProtected = false;
 *   input Boolean includeConstants = false;
 *   output TypeName classNames[:];
 * end getClassNames;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";
import type { OmcCommand } from "../../commands.js";

export const GetClassNamesInputSchema = z.object({
  typeName: z
    .string()
    .optional()
    .describe(
      "Class to inspect; omit to default to OMC's AllLoadedClasses (every loaded top-level class).",
    ),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Walk into nested classes when true; only direct children otherwise.",
    ),
  qualified: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Return fully qualified dotted names instead of bare local names.",
    ),
  sort: z
    .boolean()
    .optional()
    .default(false)
    .describe("Sort the returned class names alphabetically."),
  builtin: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include OMC built-in classes (Real, Integer, …) in the result."),
  showProtected: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include classes declared in protected sections."),
  includeConstants: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include `constant` declarations in the result."),
});
export type GetClassNamesInput = z.input<typeof GetClassNamesInputSchema>;

export const GetClassNamesOutputSchema = z.object({
  classNames: z
    .array(z.string())
    .describe(
      "Class names found inside the requested class, per the input flags.",
    ),
});
export type GetClassNamesOutput = z.infer<typeof GetClassNamesOutputSchema>;

export const GetClassNamesDescription =
  "List the class names defined inside a class (defaults to AllLoadedClasses), with flags for recursion, qualification, sorting, built-ins, protected classes, and constants.";

export async function getClassNames(
  ctx: CallContext,
  input: GetClassNamesInput = {},
): Promise<GetClassNamesOutput> {
  const flags =
    `recursive=${mlBool(input.recursive ?? false)}, ` +
    `qualified=${mlBool(input.qualified ?? false)}, ` +
    `sort=${mlBool(input.sort ?? false)}, ` +
    `builtin=${mlBool(input.builtin ?? false)}, ` +
    `showProtected=${mlBool(input.showProtected ?? false)}, ` +
    `includeConstants=${mlBool(input.includeConstants ?? false)}`;
  const cmd: OmcCommand =
    input.typeName === undefined || input.typeName === ""
      ? `getClassNames(${flags})`
      : `getClassNames(${input.typeName}, ${flags})`;
  const raw = await ctx.call(cmd);
  return parseOutput(
    GetClassNamesOutputSchema,
    { classNames: expectStringList(parse(raw)) },
    "getClassNames",
  );
}
