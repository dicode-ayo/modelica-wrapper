/**
 * Common `EvalScope` builders for `evaluateExpression`. Kept separate
 * from the evaluator itself so consumers can compose them or roll
 * their own without depending on every helper here.
 */

import type { EvalScope, EvalValue } from "./expression-evaluator.js";

/**
 * Scope backed by a flat values record keyed by the bare name. Used
 * by class-level Dialog.enable where the expression references
 * peers (`use_reset` → values["use_reset"]). Multi-segment crefs
 * (`a.b`) return `undefined`.
 */
export function recordScope(values: Record<string, EvalValue>): EvalScope {
  return {
    lookup(parts) {
      if (parts.length !== 1) return undefined;
      const name = parts[0];
      if (name === undefined) return undefined;
      return values[name];
    },
  };
}

/**
 * Wrap `inner` so an initial `prefix` segment on a cref is stripped
 * before lookup. Used by sub-component Dialog.enable where the
 * expression is written `PI.controllerType == …` but the form's
 * working values are keyed by `controllerType` directly. A cref that
 * doesn't start with `prefix` is passed through unchanged so peer
 * references still resolve.
 */
export function prefixStrippingScope(
  prefix: string,
  inner: EvalScope,
): EvalScope {
  return {
    lookup(parts) {
      if (parts.length > 0 && parts[0] === prefix) {
        return inner.lookup(parts.slice(1));
      }
      return inner.lookup(parts);
    },
    ...(inner.callFunction
      ? { callFunction: inner.callFunction.bind(inner) }
      : {}),
  };
}

/**
 * Fallthrough composition. Each scope is consulted in turn; the
 * first one that returns a non-undefined value wins. Useful when
 * the form's working values should shadow the class's static
 * parameter defaults.
 */
export function chainScopes(...scopes: ReadonlyArray<EvalScope>): EvalScope {
  return {
    lookup(parts) {
      for (const s of scopes) {
        const v = s.lookup(parts);
        if (v !== undefined) return v;
      }
      return undefined;
    },
    callFunction(name, args) {
      for (const s of scopes) {
        if (s.callFunction) {
          const v = s.callFunction(name, args);
          if (v !== undefined) return v;
        }
      }
      return undefined;
    },
  };
}
