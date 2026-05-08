/**
 * OMC: `function addComponent`
 *
 * Insert a new component into a class. `annotation` is the raw Modelica
 * annotation expression starting with `Placement(...)` (without the
 * `annotate=` prefix — we add that). Pass "" for the default placement.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddComponentInputSchema = z.object({
  /** Local instance name to give the new component. */
  componentName: z.string(),
  /** Type to instantiate (e.g. "Modelica.Blocks.Math.Gain"). */
  componentClass: z.string(),
  /** Class to insert into. */
  intoTypeName: z.string(),
  /** Raw Modelica `Placement(...)` expression; "" → default. */
  annotation: z.string().optional().default(""),
});
export type AddComponentInput = z.input<typeof AddComponentInputSchema>;

export const AddComponentOutputSchema = SuccessOutput;
export type AddComponentOutput = z.infer<typeof AddComponentOutputSchema>;

export async function addComponent(
  ctx: CallContext,
  input: AddComponentInput,
): Promise<AddComponentOutput> {
  const annotation = input.annotation ?? "";
  const ann =
    annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addComponent(${input.componentName}, ${input.componentClass}, ${input.intoTypeName}, ${ann})`,
  );
  return parseOutput(
    AddComponentOutputSchema,
    { success: expectBool(parse(raw)) },
    "addComponent",
  );
}
