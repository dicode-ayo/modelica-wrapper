/**
 * OMC: `function addConnection`
 *
 * Add a `connect(from, to)` to a class with optional Line annotation.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddConnectionInputSchema = z.object({
  from: z.string(),
  to: z.string(),
  typeName: z.string(),
  annotation: z.string().optional().default(""),
});
export type AddConnectionInput = z.input<typeof AddConnectionInputSchema>;

export const AddConnectionOutputSchema = z.object({
  success: z.boolean(),
});
export type AddConnectionOutput = z.infer<typeof AddConnectionOutputSchema>;

export async function addConnection(
  ctx: CallContext,
  input: AddConnectionInput,
): Promise<AddConnectionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addConnection(${input.from}, ${input.to}, ${input.typeName}, ${ann})`,
  );
  return parseOutput(
    AddConnectionOutputSchema,
    { success: expectBool(parse(raw)) },
    "addConnection",
  );
}
