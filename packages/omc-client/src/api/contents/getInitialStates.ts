/**
 * OMC: `function getInitialStates`
 *
 * Returns the initial-state declarations in `cl`, one row per declaration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetInitialStatesInputSchema = TypeNameInput;
export type GetInitialStatesInput = z.input<
  typeof GetInitialStatesInputSchema
>;

export const GetInitialStatesOutputSchema = z.object({
  initialStates: z.array(z.array(z.string())),
});
export type GetInitialStatesOutput = z.infer<
  typeof GetInitialStatesOutputSchema
>;

export async function getInitialStates(
  ctx: CallContext,
  input: GetInitialStatesInput,
): Promise<GetInitialStatesOutput> {
  const raw = await ctx.call(`getInitialStates(${input.typeName})`);
  const rows = expectList(parse(raw));
  const initialStates = rows.map((row) => expectStringList(row));
  return parseOutput(
    GetInitialStatesOutputSchema,
    { initialStates },
    "getInitialStates",
  );
}
