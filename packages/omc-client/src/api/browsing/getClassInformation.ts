/**
 * OMC: `function getClassInformation`
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
  restriction: z.string(),
  comment: z.string(),
  partialPrefix: z.boolean(),
  finalPrefix: z.boolean(),
  encapsulatedPrefix: z.boolean(),
  fileName: z.string(),
  fileReadOnly: z.boolean(),
  lineNumberStart: z.number().int(),
  columnNumberStart: z.number().int(),
  lineNumberEnd: z.number().int(),
  columnNumberEnd: z.number().int(),
  dimensions: z.array(z.string()),
  isProtectedClass: z.boolean(),
  isDocumentationClass: z.boolean(),
  version: z.string(),
  preferredView: z.string(),
  state: z.boolean(),
  access: z.string(),
  versionDate: z.string(),
  versionBuild: z.string(),
  dateModified: z.string(),
  revisionId: z.string(),
});
export type GetClassInformationOutput = z.infer<
  typeof GetClassInformationOutputSchema
>;

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
    dimsRaw.kind === "list"
      ? dimsRaw.items.map((d) => asString(d) ?? "")
      : [];
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
