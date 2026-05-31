/**
 * OMC: `function getNthConnection`
 *
 * Returns the n-th connection in a class as `(from, to, comment)`.
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
import { typeNameOfConnection } from "../../_shared/fields.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetNthConnectionInputSchema = z.object({
  typeName: typeNameOfConnection,
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based connection index, between 1 and `getConnectionCount`."),
});
export type GetNthConnectionInput = z.input<typeof GetNthConnectionInputSchema>;

export const GetNthConnectionOutputSchema = z.object({
  from: z.string().describe("Left-hand-side connector reference."),
  to: z.string().describe("Right-hand-side connector reference."),
  comment: z.string().describe("Description string on the connection, if any."),
});
export type GetNthConnectionOutput = z.infer<
  typeof GetNthConnectionOutputSchema
>;

export const GetNthConnectionDescription =
  "Return the n-th connection in a class as `(from, to, comment)`.";

export async function getNthConnection(
  ctx: CallContext,
  input: GetNthConnectionInput,
): Promise<GetNthConnectionOutput> {
  const raw = await ctx.call(
    `getNthConnection(${input.typeName}, ${input.index})`,
  );
  const fields = expectStringList(parse(raw));
  if (fields.length < 2) {
    throw new Error(`getNthConnection: got ${fields.length} fields, want >=2`);
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
