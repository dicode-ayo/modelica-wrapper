/**
 * Inheritance-chain traversal over a `ModelInstance`. Shared by the diagram
 * producer and the parameters-form producer — both collect declarations across
 * `extends` and must agree on the order they arrive in.
 */

import type { ModelInstance } from "./modelInstance.js";

export interface ExtendsChainNode {
  klass: ModelInstance;
  /**
   * Name of the host's DIRECT `extends` clause this `klass` was reached
   * through, or `undefined` when `klass` is the host itself. For `C extends B
   * extends A`, walking `A` yields B's name — the clause on `C` that
   * `setExtendsModifierValue` must target for a deep inherited write to land.
   */
  directBase: string | undefined;
}

/**
 * Walk a class and its inheritance chain in post-order: ancestors first, host
 * last. For a host class `C` extending `B` extending `A`, the iteration yields
 * `A`, `B`, `C` in that order, so a more-derived declaration overwrites the
 * ancestor one when a caller keys by name.
 *
 * Descends `elements[$kind=="extends"].baseClass` only — never into
 * `elements[$kind=="component"].type`. A class's inheritance chain belongs to
 * it; a sub-component's class is a foreign tree.
 *
 * Cycles are not handled — Modelica forbids inheritance cycles, and OMC would
 * already reject them upstream.
 */
export function walkExtendsChain(
  mi: ModelInstance,
): Iterable<ExtendsChainNode> {
  return walkChain(mi, undefined);
}

function* walkChain(
  mi: ModelInstance,
  directBase: string | undefined,
): Iterable<ExtendsChainNode> {
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends" && typeof e.baseClass === "object") {
      yield* walkChain(e.baseClass, directBase ?? e.baseClass.name);
    }
  }
  yield { klass: mi, directBase };
}
