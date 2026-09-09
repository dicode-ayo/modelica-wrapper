/**
 * `EvalScope` built directly from a `ModelInstance` tree, so graphic
 * annotation fields and `condition` predicates can be evaluated against a
 * class's own parameters instead of only accepted when OMC already
 * pre-reduced them to a literal.
 *
 * Pure: no OMC contact, only walks the `ModelInstance` tree already
 * fetched by the producer.
 */

import { walkExtendsChain } from "../../_shared/extendsChain.js";
import type {
  ComponentElement,
  Expression,
  ModelInstance,
} from "../../_shared/modelInstance.js";
import { ownComponents } from "./walker.js";
import {
  evaluateExpression,
  type EnumLiteralValue,
  type EvalScope,
  type EvalValue,
} from "../../eval/expression-evaluator.js";

/**
 * Find the `component` element named `name` on `mi`, searching its own
 * elements and its extends chain. Ancestors are walked first so a
 * more-derived redeclare of the same name wins — the same
 * "later assignment overwrites" pattern `collectParameters` uses in
 * `producer.ts`.
 */
function findComponent(
  mi: ModelInstance,
  name: string,
): ComponentElement | undefined {
  let found: ComponentElement | undefined;
  for (const { klass } of walkExtendsChain(mi)) {
    for (const e of ownComponents(klass)) {
      if (e.name === name) found = e;
    }
  }
  return found;
}

/** `binding` narrowed to an `EvalValue` when it's already a literal shape. */
function bindingAsEvalValue(binding: unknown): EvalValue | undefined {
  if (
    typeof binding === "string" ||
    typeof binding === "number" ||
    typeof binding === "boolean"
  ) {
    return binding;
  }
  if (
    typeof binding === "object" &&
    binding !== null &&
    (binding as { $kind?: unknown }).$kind === "enum" &&
    typeof (binding as { name?: unknown }).name === "string"
  ) {
    const tagged = binding as { name: string; index?: unknown };
    const out: EnumLiteralValue = { $kind: "enum", name: tagged.name };
    if (typeof tagged.index === "number") out.index = tagged.index;
    return out;
  }
  return undefined;
}

/**
 * Resolve one component's value. Prefers `value.binding` when it's already
 * a primitive/enum literal; otherwise recurses when `value.binding` itself
 * looks like an unreduced expression, so a parameter bound to another
 * parameter's expression resolves fully — `buildScope` hands the evaluator
 * a fully recursive scope, so a chained binding is walked to whatever depth
 * it goes. `inProgress` guards a cyclic or self-referential binding graph —
 * without it a malformed chain could recurse forever.
 */
function resolveComponentValue(
  el: ComponentElement,
  mi: ModelInstance,
  inProgress: Set<ComponentElement>,
): EvalValue {
  const value = el.value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return undefined;
  }
  if (!("binding" in value)) return undefined;
  const binding = (value as { binding?: unknown }).binding;
  const primitive = bindingAsEvalValue(binding);
  if (primitive !== undefined) return primitive;
  if (
    binding === null ||
    binding === undefined ||
    typeof binding !== "object"
  ) {
    return undefined;
  }
  if (inProgress.has(el)) return undefined;
  inProgress.add(el);
  try {
    return evaluateExpression(
      binding as Expression,
      buildScope(mi, inProgress),
      {},
    );
  } finally {
    inProgress.delete(el);
  }
}

function lookupParts(
  mi: ModelInstance,
  parts: ReadonlyArray<string>,
  inProgress: Set<ComponentElement>,
): EvalValue {
  const name = parts[0];
  if (name === undefined) return undefined;
  const el = findComponent(mi, name);
  if (el === undefined) return undefined;
  const rest = parts.slice(1);
  if (rest.length === 0) return resolveComponentValue(el, mi, inProgress);
  if (typeof el.type !== "object" || el.type === null) return undefined;
  return lookupParts(el.type, rest, inProgress);
}

function buildScope(
  mi: ModelInstance,
  inProgress: Set<ComponentElement>,
): EvalScope {
  return {
    lookup: (parts) => lookupParts(mi, parts, inProgress),
  };
}

/**
 * Build an `EvalScope` resolving crefs against `mi`'s own elements and its
 * extends chain. A single-segment cref (`useSupport`) looks up a component
 * declared on `mi`; a multi-segment cref (`t.useSupport`) resolves `t`'s
 * own type as a nested scope and recurses.
 */
export function scopeForInstance(mi: ModelInstance): EvalScope {
  return buildScope(mi, new Set<ComponentElement>());
}
