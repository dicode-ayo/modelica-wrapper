/**
 * OMC: `function addComponent`
 *
 * Insert a new component into a class. `annotation` is the raw Modelica
 * annotation expression starting with `Placement(...)` (without the
 * `annotate=` prefix — we add that). Pass "" for the default placement.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asBool, parseLeading } from "../../parse.js";

export const AddComponentInputSchema = z.object({
  /** Local instance name to give the new component. */
  componentName: z.string().describe("Local instance name to give the new component."),
  /** Type to instantiate (e.g. "Modelica.Blocks.Math.Gain"). */
  componentClass: z.string().describe('Type to instantiate (e.g. "Modelica.Blocks.Math.Gain").'),
  /** Class to insert into. */
  intoTypeName: z.string().describe("Class into which the new component is inserted."),
  /** Raw Modelica `Placement(...)` expression; "" → default. */
  annotation: z.string().optional().default("").describe('Raw Modelica `Placement(...)` annotation (no `annotate=` prefix); "" yields the default placement.'),
});
export type AddComponentInput = z.input<typeof AddComponentInputSchema>;

/**
 * `addComponent` returns `Boolean success` per the OMC docs, but real
 * builds can emit two off-spec failure shapes:
 *
 *   1. `false\nError occurred building AST` — bool plus a trailing
 *      diagnostic line.
 *   2. `Error: <message>` — no bool at all, the whole response is the
 *      error prose.
 *
 * The wrapper handles both: it captures whatever OMC wrote as
 * `diagnostic` and reports `success: false` whenever the leading
 * value isn't a boolean. The canonical error story is still
 * `getErrorString()`; `diagnostic` is the best-effort hint.
 */
export const AddComponentOutputSchema = z.object({
  success: z.boolean().describe("True if OMC reported the add succeeded."),
  diagnostic: z
    .string()
    .optional()
    .describe(
      "OMC text appended after (or in place of) the success bool. Usually a short error message on failure; absent on clean success.",
    ),
});
export type AddComponentOutput = z.infer<typeof AddComponentOutputSchema>;

export const AddComponentDescription = "Insert a new component into a class with an optional Placement annotation.";

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
  const { value, trailing } = parseLeading(raw);
  const bool = asBool(value);
  const output: { success: boolean; diagnostic?: string } =
    bool === undefined
      ? // Leading value isn't a bool — OMC returned a raw error
        // (e.g. `Error: ...`). Surface the whole response so the
        // caller has something actionable to show in the toast / REPL.
        { success: false, diagnostic: raw.trim() }
      : { success: bool };
  if (bool !== undefined && trailing.length > 0) {
    output.diagnostic = trailing;
  }
  return parseOutput(AddComponentOutputSchema, output, "addComponent");
}
