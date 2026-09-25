/**
 * OMC: `function addComponent`
 *
 * Insert a new component into a class. `annotation` is the raw Modelica
 * annotation expression starting with `Placement(...)` (without the
 * `annotate=` prefix — we add that). Pass "" for the default placement.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { modelicaExpr, modelicaName } from "../../_shared/fields.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationDiagnostic,
  parseOutput,
} from "../../_shared/parseOutput.js";
import { existClass } from "../browsing/existClass.js";
import { getComponents } from "../contents/getComponents.js";
import { qualifyPath } from "../contents/qualifyPath.js";

export const AddComponentInputSchema = z.strictObject({
  /** Local instance name to give the new component. */
  componentName: modelicaName.describe(
    "Local instance name to give the new component.",
  ),
  /** Type to instantiate (e.g. "Modelica.Blocks.Math.Gain"). */
  componentClass: modelicaName.describe(
    'Type to instantiate (e.g. "Modelica.Blocks.Math.Gain").',
  ),
  /** Class to insert into. */
  intoTypeName: modelicaName.describe(
    "Class into which the new component is inserted.",
  ),
  /** Raw Modelica `Placement(...)` expression; "" → default. */
  annotation: modelicaExpr
    .optional()
    .default("")
    .describe(
      'Raw Modelica `Placement(...)` annotation (no `annotate=` prefix); "" yields the default placement.',
    ),
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
export const AddComponentOutputSchema = SuccessWithDiagnosticOutput;
export type AddComponentOutput = z.infer<typeof AddComponentOutputSchema>;

export const AddComponentDescription =
  "Insert a new component into a class with an optional Placement annotation; refuses a duplicate component name or an unresolvable componentClass.";

/**
 * `getComponents` only reports components declared directly in
 * `intoTypeName`, not ones inherited via `extends`, so a name that collides
 * with an inherited component is not caught here — see
 * `docs/diagram-omc-reference.md`'s change-class-filter note, which
 * documents the same locally-declared-only behavior for `getElements`.
 *
 * `qualifyPath`'s scope walk resolves a name declared within `intoTypeName`
 * itself (nested or sibling classes), but whether it also resolves a name
 * reachable only through `intoTypeName`'s `import` statements is unconfirmed
 * — treat that as a likely, not confirmed, limitation.
 */
async function screenReasonToRefuse(
  ctx: CallContext,
  input: AddComponentInput,
): Promise<string | undefined> {
  try {
    if (!PREDEFINED_TYPES.has(input.componentClass)) {
      const { qualifiedPath } = await qualifyPath(ctx, {
        typeName: input.intoTypeName,
        path: input.componentClass,
      });
      const { exists } = await existClass(ctx, { typeName: qualifiedPath });
      if (!exists) {
        return `${input.componentClass} does not resolve to a known class`;
      }
    }

    const { components } = await getComponents(ctx, {
      typeName: input.intoTypeName,
    });
    if (components.some((c) => c.name === input.componentName)) {
      return `${input.intoTypeName} already declares a component named ${input.componentName}`;
    }

    return undefined;
  } catch (err) {
    return `could not verify the write is safe: ${detail(err)}`;
  }
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Modelica's four predefined types (spec §4.8) are always valid regardless
 * of what's loaded, but OMC 1.27.1's `existClass` reports `false` for them
 * — they aren't in the class symbol table the way a user/library class is.
 */
const PREDEFINED_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);

/**
 * OMC answers `success: true` for a duplicate component name or an
 * unresolvable `componentClass` — the write still corrupts the model, it
 * just doesn't say so.
 */
export async function addComponent(
  ctx: CallContext,
  input: AddComponentInput,
): Promise<AddComponentOutput> {
  const refusal = await screenReasonToRefuse(ctx, input);
  if (refusal !== undefined) {
    return { success: false, diagnostic: refusal };
  }

  const annotation = input.annotation ?? "";
  const ann =
    annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addComponent(${input.componentName}, ${input.componentClass}, ${input.intoTypeName}, ${ann})`,
  );
  return parseOutput(
    AddComponentOutputSchema,
    parseMutationDiagnostic(raw),
    "addComponent",
  );
}
