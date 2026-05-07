/**
 * OMC: `function save`
 *
 * OMEdit-deprecated: we use Option B (listFile + own writer) for production
 * paths. Provided for completeness only.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SaveInputSchema = TypeNameInput;
export type SaveInput = z.input<typeof SaveInputSchema>;

export const SaveOutputSchema = SuccessOutput;
export type SaveOutput = z.infer<typeof SaveOutputSchema>;

export async function save(
  ctx: CallContext,
  input: SaveInput,
): Promise<SaveOutput> {
  const raw = await ctx.call(`save(${input.typeName})`);
  return parseOutput(
    SaveOutputSchema,
    { success: expectBool(parse(raw)) },
    "save",
  );
}
