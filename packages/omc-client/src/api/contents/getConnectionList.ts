/**
 * OMC: `function getConnectionList`
 *
 * ```modelica
 * function getConnectionList
 *   input TypeName className;
 *   output String[:, :] result;
 * end getConnectionList;
 * ```
 *
 * Bulk replacement for repeated `getNthConnection`. Each row is a positional
 * `[from, to, comment]` tuple matching `getNthConnection`'s output.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetConnectionListInputSchema = TypeNameInput;
export type GetConnectionListInput = z.input<
  typeof GetConnectionListInputSchema
>;

export const GetConnectionListOutputSchema = z.object({
  result: z
    .array(
      z.object({
        from: z
          .string()
          .describe("Left-hand connector reference of the connect() pair."),
        to: z
          .string()
          .describe("Right-hand connector reference of the connect() pair."),
        comment: z
          .string()
          .describe("Description string on the connection, if any."),
      }),
    )
    .describe(
      "All connections in the class, each as a (from, to, comment) row.",
    ),
});
export type GetConnectionListOutput = z.infer<
  typeof GetConnectionListOutputSchema
>;

export const GetConnectionListDescription =
  "Return all connections in a class as a list of `(from, to, comment)` rows; bulk replacement for repeated `getNthConnection` calls.";

export async function getConnectionList(
  ctx: CallContext,
  input: GetConnectionListInput,
): Promise<GetConnectionListOutput> {
  const raw = await ctx.call(`getConnectionList(${input.typeName})`);
  const rows = expectList(parse(raw));
  const result = rows.map((row, idx) => {
    const fields = expectStringList(row);
    if (fields.length < 2) {
      throw new Error(
        `getConnectionList row ${idx}: got ${fields.length} fields, want >=2`,
      );
    }
    return {
      from: fields[0] ?? "",
      to: fields[1] ?? "",
      comment: fields[2] ?? "",
    };
  });
  return parseOutput(
    GetConnectionListOutputSchema,
    { result },
    "getConnectionList",
  );
}
