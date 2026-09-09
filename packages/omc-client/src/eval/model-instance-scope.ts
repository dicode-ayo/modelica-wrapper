/**
 * `EvalScope` over a `getModelInstance` tree, resolving the
 * instance-qualified crefs OMC writes into graphic annotation fields
 * (`t.useSupport`, `m.leaf.show`). Paths are absolute from the root the
 * scope was built on — the same rule OMEdit's `Model::getVariableBinding`
 * follows.
 */

import type {
  ComponentElement,
  Expression,
  ModelInstance,
} from "../_shared/modelInstance.js";
import type { EvalScope, EvalValue } from "./expression-evaluator.js";
import { evaluateExpression } from "./expression-evaluator.js";

/**
 * An `extends` clause contributes its base class's components to the
 * enclosing name space, so walking into one must NOT consume a path
 * segment.
 */
function findComponent(
  mi: ModelInstance,
  name: string,
): ComponentElement | undefined {
  for (const el of mi.elements ?? []) {
    if (el.$kind === "component") {
      if (el.name === name) return el;
    } else if (typeof el.baseClass === "object" && el.baseClass !== null) {
      const inherited = findComponent(el.baseClass, name);
      if (inherited) return inherited;
    }
  }
  return undefined;
}

function isLiteral(v: unknown): v is number | boolean | string | null {
  return (
    v === null ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "string"
  );
}

/**
 * OMC writes a component's binding two ways: `{ binding }` alone when the
 * declaration is already a literal, and `{ binding, value }` when it had to
 * reduce a cref or an expression. `value` is only OMC's best effort — a
 * parameter with no default of its own (`parameter Boolean noDefault;`)
 * comes back with the cref echoed rather than folded, so a non-literal
 * lands back on the evaluator.
 */
function valueOf(el: ComponentElement, scope: EvalScope): EvalValue {
  const value = el.value;
  if (typeof value !== "object" || value === null) return undefined;
  const wrapper = value as { value?: unknown; binding?: unknown };
  const expr = wrapper.value !== undefined ? wrapper.value : wrapper.binding;
  if (isLiteral(expr)) return expr;
  if (expr === undefined) return undefined;
  return evaluateExpression(expr as Expression, scope);
}

function resolve(
  mi: ModelInstance,
  parts: ReadonlyArray<string>,
  scope: EvalScope,
): EvalValue {
  const head = parts[0];
  if (head === undefined) return undefined;
  const el = findComponent(mi, head);
  if (el === undefined) return undefined;
  if (parts.length > 1) {
    if (typeof el.type !== "object" || el.type === null) return undefined;
    return resolve(el.type, parts.slice(1), scope);
  }
  return valueOf(el, scope);
}

/**
 * Build a scope resolving paths against `root`. Names are looked up exactly
 * as OMC writes them into annotations — absolute from `root`, so the scope
 * for an opened class serves every layer beneath it. An unresolvable path
 * yields `undefined` and leaves the caller on its own default.
 */
export function modelInstanceScope(root: ModelInstance): EvalScope {
  // A binding that resolves through other bindings can be cyclic; the
  // ModelInstance tree is JSON, so nothing upstream has ruled that out.
  const resolving = new Set<string>();
  const scope: EvalScope = {
    lookup(parts) {
      const key = parts.join(".");
      if (resolving.has(key)) return undefined;
      resolving.add(key);
      try {
        return resolve(root, parts, scope);
      } finally {
        resolving.delete(key);
      }
    },
  };
  return scope;
}
