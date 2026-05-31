/**
 * OMC: `function getClassInformation`
 *
 * Returns detailed metadata about a class — restriction kind, doc comment,
 * partial/final/encapsulated prefixes, source file location, dimensions,
 * version info, and revision id — in a single round trip.
 *
 * ```modelica
 * function getClassInformation
 *   input TypeName cl;
 *   output String restriction, comment;
 *   output Boolean partialPrefix, finalPrefix, encapsulatedPrefix;
 *   output String fileName;
 *   output Boolean fileReadOnly;
 *   output Integer lineNumberStart, columnNumberStart, lineNumberEnd, columnNumberEnd;
 *   output String dimensions[:];
 *   output Boolean isProtectedClass;
 *   output Boolean isDocumentationClass;
 *   output String version;
 *   output String preferredView;
 *   output Boolean state;
 *   output String access;
 *   output String versionDate;
 *   output String versionBuild;
 *   output String dateModified;
 *   output String revisionId;
 * end getClassInformation;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import {
  asBool,
  asInt,
  asString,
  expectList,
  parse,
  type Value,
} from "../../parse.js";

export const GetClassInformationInputSchema = TypeNameInput;
export type GetClassInformationInput = z.input<
  typeof GetClassInformationInputSchema
>;

export const GetClassInformationOutputSchema = z.object({
  restriction: z
    .string()
    .describe("Class restriction kind (model, package, function, block, …)."),
  comment: z.string().describe("Leading documentation comment on the class."),
  partialPrefix: z
    .boolean()
    .describe("True if the class is declared `partial`."),
  finalPrefix: z.boolean().describe("True if the class is declared `final`."),
  encapsulatedPrefix: z
    .boolean()
    .describe("True if the class is declared `encapsulated`."),
  fileName: z
    .string()
    .describe("Source file path containing the class definition."),
  fileReadOnly: z
    .boolean()
    .describe("True when the source file is read-only on disk."),
  lineNumberStart: z
    .number()
    .int()
    .describe("Source line where the class declaration begins (1-based)."),
  columnNumberStart: z
    .number()
    .int()
    .describe("Source column where the class declaration begins (1-based)."),
  lineNumberEnd: z
    .number()
    .int()
    .describe("Source line where the class declaration ends (1-based)."),
  columnNumberEnd: z
    .number()
    .int()
    .describe("Source column where the class declaration ends (1-based)."),
  dimensions: z
    .array(z.string())
    .describe(
      "Array dimensions as raw expression strings (per OMC docs: not evaluated to integers).",
    ),
  isProtectedClass: z
    .boolean()
    .describe("True if the class lives in a protected section."),
  isDocumentationClass: z
    .boolean()
    .describe("True if the class is annotated as a documentation-only class."),
  version: z
    .string()
    .describe(
      "Library version string from the version annotation, when present.",
    ),
  preferredView: z
    .string()
    .describe('Preferred view as set in annotations (e.g. "info", "diagram").'),
  state: z
    .boolean()
    .describe("True if the class participates as a state machine state."),
  access: z
    .string()
    .describe("Access annotation value controlling library protection levels."),
  versionDate: z
    .string()
    .describe("Version-date string from the version annotation."),
  versionBuild: z
    .string()
    .describe("Version-build string from the version annotation."),
  dateModified: z
    .string()
    .describe("Date-modified string from the version annotation."),
  revisionId: z
    .string()
    .describe("Revision id string from the version annotation."),
});
export type GetClassInformationOutput = z.infer<
  typeof GetClassInformationOutputSchema
>;

export const GetClassInformationDescription =
  "Return detailed metadata for a class: restriction kind, doc comment, partial/final/encapsulated flags, source file location, dimensions, version info, and revision id.";

export async function getClassInformation(
  ctx: CallContext,
  input: GetClassInformationInput,
): Promise<GetClassInformationOutput> {
  const raw = await ctx.call(`getClassInformation(${input.typeName})`);
  const items = expectList(parse(raw));
  if (items.length < 22) {
    throw new Error(
      `getClassInformation: got ${items.length} fields, want >=22`,
    );
  }
  const at = (i: number): Value => items[i] as Value;
  const str = (i: number): string => asString(at(i)) ?? "";
  const bl = (i: number): boolean => asBool(at(i)) ?? false;
  const num = (i: number): number => asInt(at(i)) ?? 0;
  const dimsRaw = at(11);
  const dimensions =
    dimsRaw.kind === "list" ? dimsRaw.items.map((d) => asString(d) ?? "") : [];
  return parseOutput(
    GetClassInformationOutputSchema,
    {
      restriction: str(0),
      comment: str(1),
      partialPrefix: bl(2),
      finalPrefix: bl(3),
      encapsulatedPrefix: bl(4),
      fileName: str(5),
      fileReadOnly: bl(6),
      lineNumberStart: num(7),
      columnNumberStart: num(8),
      lineNumberEnd: num(9),
      columnNumberEnd: num(10),
      dimensions,
      isProtectedClass: bl(12),
      isDocumentationClass: bl(13),
      version: str(14),
      preferredView: str(15),
      state: bl(16),
      access: str(17),
      versionDate: str(18),
      versionBuild: str(19),
      dateModified: str(20),
      revisionId: str(21),
    },
    "getClassInformation",
  );
}
