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
import {
  modifierToDisplayString,
  unquoteString,
} from "../../_shared/unitResolution.js";
import { ownComponents } from "./walker.js";
import {
  evaluateExpression,
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

/**
 * Parse a flattened modifier display string (`modifierToDisplayString`)
 * into an `EvalValue`. `modifiers.$value` is OMC's raw, unparsed
 * expression text, not an `Expression` AST, so only its literal forms
 * (booleans, quoted strings, numbers) are recognized — a compound
 * expression (`"1 + 2"`, `"not useSupport"`) has no parser here and
 * resolves to `undefined`.
 */
function literalModifierAsEvalValue(text: string): EvalValue {
  if (text.length === 0) return undefined;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return unquoteString(text);
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve one component's value: the evaluated literal `value.value` if
 * present, else `value.binding` evaluated against `mi`, else the literal
 * `modifiers.$value` — the same three-source order `parameterDisplayValue`
 * in `producer.ts` uses. `buildScope` hands the evaluator a fully recursive
 * scope, so a parameter bound to another parameter resolves to whatever
 * depth the chain goes; `inProgress` bounds a cyclic binding graph.
 */
function resolveComponentValue(
  el: ComponentElement,
  mi: ModelInstance,
  inProgress: Set<ComponentElement>,
): EvalValue {
  const value = el.value;
  if (value !== null && typeof value === "object") {
    const evaluated = (value as { value?: unknown }).value;
    if (
      typeof evaluated === "number" ||
      typeof evaluated === "boolean" ||
      typeof evaluated === "string"
    ) {
      return evaluated;
    }
    const binding = (value as { binding?: unknown }).binding;
    if (binding !== undefined && !inProgress.has(el)) {
      inProgress.add(el);
      try {
        const result = evaluateExpression(
          binding as Expression,
          buildScope(mi, inProgress),
        );
        if (result !== undefined) return result;
      } finally {
        inProgress.delete(el);
      }
    }
  }
  return literalModifierAsEvalValue(modifierToDisplayString(el.modifiers));
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
