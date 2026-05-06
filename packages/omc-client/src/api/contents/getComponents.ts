/**
 * OMC: `function getComponents`
 *
 * ```modelica
 * function getComponents
 *   input TypeName className;
 *   input Boolean useQuotes = false;
 * end getComponents;
 * ```
 *
 * Output: a 2D string matrix with one row per component. The 12 row fields are
 * not declared in the OMC interface signature (the function is `external "C"`),
 * so we follow OMEdit's de-facto field naming convention.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import {
  asBool,
  asString,
  expectList,
  parse,
  type Value,
} from "../../parse.js";

export const GetComponentsInputSchema = z.object({
  typeName: z.string(),
  useQuotes: z.boolean().optional().default(false),
});
export type GetComponentsInput = z.input<typeof GetComponentsInputSchema>;

export const ComponentInfoSchema = z.object({
  /** Type of the component (e.g. "Modelica.Blocks.Math.Gain"). */
  className: z.string(),
  /** Local instance name. */
  name: z.string(),
  /** Description string. */
  comment: z.string(),
  /** "public" | "protected". */
  protection: z.string(),
  isFinal: z.boolean(),
  isFlow: z.boolean(),
  isStream: z.boolean(),
  isReplaceable: z.boolean(),
  /** "constant" | "parameter" | "discrete" | "" (continuous). */
  variability: z.string(),
  /** "inner" | "outer" | "inner outer" | "". */
  innerOuter: z.string(),
  /** "input" | "output" | "". */
  causality: z.string(),
  /** Array dimensions as raw expression strings. */
  dimensions: z.array(z.string()),
});
export type ComponentInfo = z.infer<typeof ComponentInfoSchema>;

export const GetComponentsOutputSchema = z.object({
  components: z.array(ComponentInfoSchema),
});
export type GetComponentsOutput = z.infer<typeof GetComponentsOutputSchema>;

export async function getComponents(
  ctx: CallContext,
  input: GetComponentsInput,
): Promise<GetComponentsOutput> {
  const useQuotes = input.useQuotes ?? false;
  const raw = await ctx.call(
    `getComponents(${input.typeName}, useQuotes=${mlBool(useQuotes)})`,
  );
  const rows = expectList(parse(raw));
  const components = rows.map((row, idx) => {
    const fields = expectList(row);
    if (fields.length < 12) {
      throw new Error(
        `getComponents row ${idx}: got ${fields.length} fields, want >=12`,
      );
    }
    const at = (i: number): Value => fields[i] as Value;
    const str = (i: number): string => asString(at(i)) ?? "";
    const bl = (i: number): boolean => asBool(at(i)) ?? false;
    const dimsRaw = at(11);
    const dimensions =
      dimsRaw.kind === "list"
        ? dimsRaw.items.map((d) => asString(d) ?? "")
        : [];
    return {
      className: str(0),
      name: str(1),
      comment: str(2),
      protection: str(3),
      isFinal: bl(4),
      isFlow: bl(5),
      isStream: bl(6),
      isReplaceable: bl(7),
      variability: str(8),
      innerOuter: str(9),
      causality: str(10),
      dimensions,
    };
  });
  return parseOutput(
    GetComponentsOutputSchema,
    { components },
    "getComponents",
  );
}
