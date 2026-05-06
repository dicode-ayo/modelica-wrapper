/**
 * OMC: `function getNthConnection`
 *
 * ```modelica
 * function getNthConnection
 *   input TypeName className;
 *   input Integer index;
 *   output String[:] result;
 * end getNthConnection;
 * ```
 *
 * The result array holds three positional fields: from, to, comment.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetNthConnectionInputSchema = z.object({
  typeName: z.string(),
  index: z.number().int().positive(),
});
export type GetNthConnectionInput = z.input<
  typeof GetNthConnectionInputSchema
>;

export const GetNthConnectionOutputSchema = z.object({
  from: z.string(),
  to: z.string(),
  comment: z.string(),
});
export type GetNthConnectionOutput = z.infer<
  typeof GetNthConnectionOutputSchema
>;

export async function getNthConnection(
  ctx: CallContext,
  input: GetNthConnectionInput,
): Promise<GetNthConnectionOutput> {
  const raw = await ctx.call(
    `getNthConnection(${input.typeName}, ${input.index})`,
  );
  const fields = expectStringList(parse(raw));
  if (fields.length < 2) {
    throw new Error(
      `getNthConnection: got ${fields.length} fields, want >=2`,
    );
  }
  return parseOutput(
    GetNthConnectionOutputSchema,
    {
      from: fields[0] ?? "",
      to: fields[1] ?? "",
      comment: fields[2] ?? "",
    },
    "getNthConnection",
  );
}
