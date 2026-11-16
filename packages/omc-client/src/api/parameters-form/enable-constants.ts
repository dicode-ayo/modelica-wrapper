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
 *
 * A name is written relative to the class that declares the field (an import
 * alias `SI.x`, a sibling package `Constants.eps`), while OMC evaluates a bare
 * reference at global scope. Each name is therefore qualified in its
 * declaring class's scope first; every step that cannot settle a single
 * global meaning drops the name, which leaves its field enabled.
 */

import type { ComponentRef } from "../../_shared/modelInstance.js";
import { constantReference } from "../../commands.js";
import { enclosingScope } from "../../qualified-name.js";
import type { EnableConstantValue, ParameterModel } from "./types.js";

/** A dotted name as written in a `Dialog.enable`, with the class declaring that field. */
export interface EnableConstantRef {
  declaringClass: string;
  name: string;
}

/**
 * The dotted names in `model`'s `Dialog.enable` expressions that the form
 * cannot resolve locally, deduplicated per declaring class: more than one
 * segment, a first segment that is neither a field nor the component prefix,
 * and nothing but plain identifiers. A subscripted, quoted or otherwise
 * unusual cref is never returned, so it never reaches OMC.
 */
export function collectEnableConstantNames(
  model: ParameterModel,
): EnableConstantRef[] {
  const local = new Set(model.fields.map((f) => f.name));
  if (model.component !== undefined) local.add(model.component);
  const refs = new Map<string, EnableConstantRef>();
  for (const f of model.fields) {
    const declaringClass = f.declaredIn ?? model.className;
    const visit = (expr: unknown): void => {
      if (typeof expr !== "object" || expr === null) return;
      if (Array.isArray(expr)) {
        for (const e of expr) visit(e);
        return;
      }
      if (isComponentRef(expr)) {
        const name = externalConstantName(expr, local);
        if (name !== undefined) {
          refs.set(`${declaringClass}\n${name}`, { declaringClass, name });
        }
        return;
      }
      for (const v of Object.values(expr)) visit(v);
    };
    visit(f.dialog.enable);
  }
  return [...refs.values()];
}

function isComponentRef(v: object): v is ComponentRef {
  return (
    "$kind" in v && v.$kind === "cref" && "parts" in v && Array.isArray(v.parts)
  );
}

function externalConstantName(
  ref: ComponentRef,
  local: ReadonlySet<string>,
): string | undefined {
  const [head] = ref.parts;
  if (head === undefined || local.has(head.name)) return undefined;
  if (ref.parts.some((p) => (p.subscripts?.length ?? 0) > 0)) return undefined;
  const name = ref.parts.map((p) => p.name).join(".");
  return constantReference(name) === undefined ? undefined : name;
}

/** The OMC reads {@link resolveEnableConstants} needs. */
export interface EnableConstantClient {
  qualifyPath(input: {
    typeName: string;
    path: string;
  }): Promise<{ qualifiedPath: string }>;
  getClassNames(): Promise<{ classNames: string[] }>;
  evaluateConstant(input: {
    name: string;
  }): Promise<{ value: EnableConstantValue }>;
}

/**
 * `model` with `constants` filled from OMC for every name
 * {@link collectEnableConstantNames} finds, keyed by the name as written.
 *
 * A name is left out when it qualifies into the model's class or a class on
 * its extends chain (a local or replaceable class an instance may redeclare),
 * when qualifying it fails, when two declaring classes give it different
 * meanings, when its qualified top-level class is not already loaded, or when
 * OMC fails to evaluate it. Returns `model` itself when nothing resolves.
 */
export async function resolveEnableConstants(
  client: EnableConstantClient,
  model: ParameterModel,
): Promise<ParameterModel> {
  const refs = collectEnableConstantNames(model);
  if (refs.length === 0) return model;

  // Listed before any lookup, so the loaded check reflects the session as it
  // was rather than whatever a `qualifyPath` lookup pulled in.
  let loaded: ReadonlySet<string>;
  try {
    loaded = new Set((await client.getClassNames()).classNames);
  } catch {
    return model;
  }

  const redeclarable = [model.className, ...(model.ancestors ?? [])];
  // `null` marks a written name with no single usable global meaning.
  const qualifiedByName = new Map<string, string | null>();
  for (const { declaringClass, name } of refs) {
    if (qualifiedByName.get(name) === null) continue;
    const qualified = await qualifyConstant(
      client,
      declaringClass,
      name,
      redeclarable,
    );
    const prior = qualifiedByName.get(name);
    qualifiedByName.set(
      name,
      qualified === undefined || (prior !== undefined && prior !== qualified)
        ? null
        : qualified,
    );
  }

  const constants: Record<string, EnableConstantValue> = {};
  const evaluated = new Map<string, EnableConstantValue | undefined>();
  for (const [name, qualified] of qualifiedByName) {
    if (qualified === null) continue;
    const [top] = qualified.split(".", 1);
    if (top === undefined || !loaded.has(top)) continue;
    if (!evaluated.has(qualified)) {
      evaluated.set(qualified, await evaluate(client, qualified));
    }
    const value = evaluated.get(qualified);
    if (value !== undefined) constants[name] = value;
  }
  if (Object.keys(constants).length === 0) return model;
  return { ...model, constants };
}

/**
 * `name` qualified in `declaringClass`'s scope, or `undefined` when it cannot
 * be, or when it lands inside one of `redeclarable`.
 *
 * Only a name whose qualified top-level library is already loaded is ever
 * evaluated. OMC's lookup here, or a constant's binding later, may still load
 * a library that one depends on (as MSL's use of ModelicaServices does); that
 * is unconfirmed against live OMC.
 */
async function qualifyConstant(
  client: EnableConstantClient,
  declaringClass: string,
  name: string,
  redeclarable: readonly string[],
): Promise<string | undefined> {
  const scope = enclosingScope(name);
  const leaf = name.slice(scope.length + 1);
  let qualifiedPath: string;
  try {
    ({ qualifiedPath } = await client.qualifyPath({
      typeName: declaringClass,
      path: scope,
    }));
  } catch {
    return undefined;
  }
  if (
    redeclarable.some(
      (c) => qualifiedPath === c || qualifiedPath.startsWith(`${c}.`),
    )
  ) {
    return undefined;
  }
  const qualified = `${qualifiedPath}.${leaf}`;
  return constantReference(qualified) === undefined ? undefined : qualified;
}

async function evaluate(
  client: EnableConstantClient,
  name: string,
): Promise<EnableConstantValue | undefined> {
  try {
    return (await client.evaluateConstant({ name })).value;
  } catch {
    return undefined;
  }
}
