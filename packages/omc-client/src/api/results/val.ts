/**
 * OMC: `function val`
 *
 * ```modelica
 * function val
 *   input VariableName var;
 *   input Real timePoint = 0.0;
 *   input String fileName = "<default>";
 *   output Real valAtTime;
 * end val;
 * ```
 *
 * `var` is a Modelica variable identifier (dotted path) emitted bare. The
 * default `fileName` `"<default>"` reads from `currentSimulationResult`.
 *
 * Note: input field is `var` (verbatim from OMC). JS keyword; safe as a property
 * but quoted-key syntax improves readability: `client.val({ "var": "x.y" })`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectFloat, parse } from "../../parse.js";

export const ValInputSchema = z.object({
  var: z.string(),
  timePoint: z.number().optional().default(0.0),
  fileName: z.string().optional().default("<default>"),
});
export type ValInput = z.input<typeof ValInputSchema>;

export const ValOutputSchema = z.object({
  valAtTime: z.number(),
});
export type ValOutput = z.infer<typeof ValOutputSchema>;

export async function val(
  ctx: CallContext,
  input: ValInput,
): Promise<ValOutput> {
  const timePoint = input.timePoint ?? 0.0;
  const fileName = input.fileName ?? "<default>";
  // Omit fileName on the documented sentinel so OMC's parser-level default
  // (currentSimulationResult) kicks in; passing the literal "<default>" string
  // would not trigger the runtime sentinel path.
  const fileArg = fileName === "<default>" ? "" : `, ${quote(fileName)}`;
  const raw = await ctx.call(
    `val(${input.var}, ${timePoint}${fileArg})`,
  );
  return parseOutput(
    ValOutputSchema,
    { valAtTime: expectFloat(parse(raw)) },
    "val",
  );
}
