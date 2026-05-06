/**
 * OMC: `function getTransitions`
 *
 * Returns state-machine transitions in `cl`. Each transition is a 7-tuple
 * (from, to, condition, immediate, reset, synchronize, priority); we surface
 * the raw rows for now and let downstream code interpret as needed.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetTransitionsInputSchema = TypeNameInput;
export type GetTransitionsInput = z.input<typeof GetTransitionsInputSchema>;

export const GetTransitionsOutputSchema = z.object({
  transitions: z.array(z.array(z.string())),
});
export type GetTransitionsOutput = z.infer<
  typeof GetTransitionsOutputSchema
>;

export async function getTransitions(
  ctx: CallContext,
  input: GetTransitionsInput,
): Promise<GetTransitionsOutput> {
  const raw = await ctx.call(`getTransitions(${input.typeName})`);
  const rows = expectList(parse(raw));
  const transitions = rows.map((row) => expectStringList(row));
  return parseOutput(
    GetTransitionsOutputSchema,
    { transitions },
    "getTransitions",
  );
}
