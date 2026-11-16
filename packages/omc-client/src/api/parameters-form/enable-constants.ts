/**
 * Host-side resolution of the library constants a parameter model's
 * `Dialog.enable` expressions reference.
 *
 * The form evaluates `enable` in the webview against its working values,
 * which cover peers (`use_reset`) and, through the component prefix,
 * instance-qualified refs (`PI.controllerType`). A reference to a constant
 * declared outside the model (`k > Modelica.Constants.eps`) resolves against
 * neither, and an unresolved cref leaves the field enabled. Those names are
 * evaluated through OMC once per form open and carried on
 * `ParameterModel.constants`.
 */

import type { ComponentRef, Expression } from "../../_shared/modelInstance.js";
import { constantReference } from "../../commands.js";
import type { EnableConstantValue, ParameterModel } from "./types.js";

/**
 * The deduplicated dotted names in `model`'s `Dialog.enable` expressions that
 * the form cannot resolve locally: more than one segment, a first segment that
 * is neither a field nor the component prefix, and nothing but plain
 * identifiers. A subscripted, quoted or otherwise unusual cref is never
 * returned, so it never reaches OMC.
 */
export function collectEnableConstantNames(model: ParameterModel): string[] {
  const local = new Set(model.fields.map((f) => f.name));
  if (model.component !== undefined) local.add(model.component);
  const names = new Set<string>();
  const visit = (expr: Expression | undefined): void => {
    if (expr === null || expr === undefined || typeof expr !== "object") {
      return;
    }
    if (Array.isArray(expr)) {
      for (const e of expr) visit(e);
      return;
    }
    if (expr.$kind === "cref") {
      const name = constantName(expr as ComponentRef, local);
      if (name !== undefined) names.add(name);
      return;
    }
    for (const v of Object.values(expr)) visit(v as Expression);
  };
  for (const f of model.fields) visit(f.dialog.enable);
  return [...names];
}

function constantName(
  ref: ComponentRef,
  local: ReadonlySet<string>,
): string | undefined {
  const [head] = ref.parts;
  if (head === undefined || local.has(head.name)) return undefined;
  if (ref.parts.some((p) => (p.subscripts?.length ?? 0) > 0)) return undefined;
  const name = ref.parts.map((p) => p.name).join(".");
  return constantReference(name) === undefined ? undefined : name;
}

/** The OMC read {@link resolveEnableConstants} needs. */
export interface EnableConstantClient {
  evaluateConstant(input: {
    name: string;
  }): Promise<{ value: EnableConstantValue }>;
}

/**
 * `model` with `constants` filled from OMC for every name
 * {@link collectEnableConstantNames} finds. A name OMC fails to evaluate, or
 * reduces to something other than a scalar literal, is left out. Returns
 * `model` itself when nothing resolves.
 */
export async function resolveEnableConstants(
  client: EnableConstantClient,
  model: ParameterModel,
): Promise<ParameterModel> {
  const names = collectEnableConstantNames(model);
  if (names.length === 0) return model;
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const { value } = await client.evaluateConstant({ name });
        return isScalarLiteral(value) ? ([name, value] as const) : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const constants: Record<string, EnableConstantValue> = {};
  for (const r of results) {
    if (r !== undefined) constants[r[0]] = r[1];
  }
  if (Object.keys(constants).length === 0) return model;
  return { ...model, constants };
}

/** Finite, so the model stays JSON-serializable on its way to the webview. */
function isScalarLiteral(v: unknown): v is EnableConstantValue {
  return (
    typeof v === "boolean" ||
    typeof v === "string" ||
    (typeof v === "number" && Number.isFinite(v))
  );
}
