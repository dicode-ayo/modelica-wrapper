/**
 * OMC: `function getComponentAnnotations`
 *
 * Returns the raw `Placement(...)` annotations for each component in `cl`,
 * as a list of nested Modelica expressions. Pass-through as parsed `Value`
 * trees so the annotations parser (downstream) can walk them.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { expectList, parse } from "../../parse.js";

export const GetComponentAnnotationsInputSchema = TypeNameInput;
export type GetComponentAnnotationsInput = z.input<
  typeof GetComponentAnnotationsInputSchema
>;

export const GetComponentAnnotationsOutputSchema = z.object({
  annotations: z
    .array(ValueSchema)
    .describe(
      "One annotation per declared component, as a parsed Value tree (often `Placement(...)`).",
    ),
});
export type GetComponentAnnotationsOutput = z.infer<
  typeof GetComponentAnnotationsOutputSchema
>;

export const GetComponentAnnotationsDescription =
  "Return the annotations of the components in the given class.";

export async function getComponentAnnotations(
  ctx: CallContext,
  input: GetComponentAnnotationsInput,
): Promise<GetComponentAnnotationsOutput> {
  const raw = await ctx.call(`getComponentAnnotations(${input.typeName})`);
  const annotations = expectList(parse(raw));
  return parseOutput(
    GetComponentAnnotationsOutputSchema,
    { annotations },
    "getComponentAnnotations",
  );
}
