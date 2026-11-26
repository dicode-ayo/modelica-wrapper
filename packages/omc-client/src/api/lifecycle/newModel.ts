/**
 * OMC: `function newModel`
 *
 * ```modelica
 * function newModel
 *   input TypeName className;
 *   input TypeName withinPath;
 *   output Boolean success;
 * end newModel;
 * ```
 *
 * Creates a new empty model inside the package named by `withinPath`. This is
 * the documented, working replacement on OMC 1.26.x for the absent
 * class-create scripting calls (their phantom wrappers were removed — see
 * `docs/coverage.md` "Removed wrappers").
 *
 * **`withinPath` is required.** OMC's interactive RPC rejects an empty second
 * argument ("Unexpected token near: newModel"), so there is no top-level
 * creation form — the target package must already exist in the symbol table.
 * To create a genuinely top-level class, fall back to `loadString`:
 *
 * ```ts
 * await client.loadString({
 *   data: `model ${name}\nend ${name};`,
 *   filename: `<runtime:${name}>`,
 * });
 * ```
 *
 * The created class is always a `model` (OMC's `newModel` has no restriction
 * argument). For other restrictions (block, package, record, …) use
 * `loadString` with the appropriate keyword.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { modelicaName } from "../../_shared/fields.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationSuccess,
  parseOutput,
} from "../../_shared/parseOutput.js";
import { existClass } from "../browsing/existClass.js";

export const NewModelInputSchema = z.strictObject({
  typeName: modelicaName.describe(
    "TypeName of the new model to create (OMC parameter `className`); emitted to OMC unquoted.",
  ),
  withinPath: modelicaName.describe(
    "TypeName of the existing package to create the model inside (OMC parameter `withinPath`); emitted to OMC unquoted. Required — OMC has no top-level creation form, so the package must already be loaded.",
  ),
});
export type NewModelInput = z.input<typeof NewModelInputSchema>;

export const NewModelOutputSchema = SuccessWithDiagnosticOutput;
export type NewModelOutput = z.infer<typeof NewModelOutputSchema>;

export const NewModelDescription =
  "Create a new empty model inside the given package. The replacement on OMC 1.26.x for the absent class-create scripting calls; the target package must already exist (there is no top-level form — use loadString for that). The class lives in OMC's symbol table only: it has no file until setSourceFile names one and save writes it, and nothing adds it to the package's package.order. Refuses a model that already exists, which OMC would replace with an empty one.";

async function screenReasonToRefuse(
  ctx: CallContext,
  input: NewModelInput,
): Promise<string | undefined> {
  const qualifiedName = `${input.withinPath}.${input.typeName}`;
  try {
    const { exists } = await existClass(ctx, { typeName: qualifiedName });
    if (exists) {
      return `${qualifiedName} already exists — creating it again would replace it with an empty model`;
    }
    return undefined;
  } catch (err) {
    return `could not verify the write is safe: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * OMC answers `success: true` for a model that already exists, and replaces
 * it with an empty one.
 */
export async function newModel(
  ctx: CallContext,
  input: NewModelInput,
): Promise<NewModelOutput> {
  const refusal = await screenReasonToRefuse(ctx, input);
  if (refusal !== undefined) {
    return { success: false, diagnostic: refusal };
  }

  const raw = await ctx.call(
    `newModel(${input.typeName}, ${input.withinPath})`,
  );
  return parseOutput(
    NewModelOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "newModel") },
    "newModel",
  );
}
