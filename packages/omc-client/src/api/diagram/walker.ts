/**
 * Extends-chain walker utilities.
 *
 * Both icon collection and connector collection follow the same recursion:
 * descend `elements[$kind=="extends"].baseClass.elements` only — never
 * descend into `elements[$kind=="component"].type.elements`. A class's
 * inheritance chain belongs to it; a sub-component's class is a foreign
 * tree handled separately by the producer's class registry.
 *
 * Yields are POST-ORDER: ancestors first, host last. Renderers can map
 * shapes to layers in stacking-order naturally — earlier yields paint
 * underneath later ones.
 */

import type {
  ComponentElement,
  ElementNode,
  ModelInstance,
} from "../../_shared/modelInstance.js";

/**
 * Walk a class and its inheritance chain in post-order.
 *
 * For a host class `C` extending `B` extending `A`, the iteration yields
 * `A`, `B`, `C` in that order. Cycles are not handled — Modelica forbids
 * inheritance cycles, and OMC would already reject them upstream.
 */
export function* walkExtendsChain(mi: ModelInstance): Iterable<ModelInstance> {
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends" && typeof e.baseClass === "object") {
      yield* walkExtendsChain(e.baseClass);
    }
  }
  yield mi;
}

/**
 * The `$kind="component"` elements declared DIRECTLY on `mi`. Does not
 * recurse into the extends chain — compose with `walkExtendsChain` to get
 * inheritance-aware collections.
 */
export function ownComponents(mi: ModelInstance): ComponentElement[] {
  const out: ComponentElement[] = [];
  for (const e of mi.elements ?? []) {
    if (e.$kind === "component") out.push(e);
  }
  return out;
}

/**
 * Sub-components declared directly on `mi`. A sub-component is a
 * `$kind="component"` element whose `type` is a `ModelInstance` (object,
 * not a primitive `"Real"`/`"Boolean"` string and not absent) AND whose
 * type's restriction is NOT `connector` (those are surfaced separately
 * via `ownConnectors`) and NOT `type` (Modelica `type` aliases like
 * `Modelica.Units.SI.Angle` — they're not graphical).
 *
 * NOTE: filtering by `restriction !== "type"` covers the common
 * SI-units-as-parameter pattern. Consumers wanting non-graphical
 * variables (e.g. for a parameter table) should look elsewhere — this
 * is a DIAGRAM-layout walker.
 */
export function ownSubComponents(mi: ModelInstance): ComponentElement[] {
  const out: ComponentElement[] = [];
  for (const e of ownComponents(mi)) {
    if (typeof e.type !== "object" || e.type === null) continue;
    const restr = e.type.restriction;
    if (restr === "connector" || restr === "type") continue;
    out.push(e);
  }
  return out;
}

/**
 * Standalone connectors declared directly on `mi`. Identified by
 * `e.type.restriction === "connector"` — NOT by the `prefixes.connector`
 * field (which carries flow/stream keywords on a connector's INNER
 * variables, unrelated to whether the element is a port).
 *
 * Components with `prefixes.direction === "input"|"output"` whose `type`
 * is a primitive string (e.g. `"Real"`) are scalar variables — they get
 * skipped here and aren't graphical ports either.
 */
export function ownConnectors(mi: ModelInstance): ComponentElement[] {
  const out: ComponentElement[] = [];
  for (const e of ownComponents(mi)) {
    if (
      typeof e.type === "object" &&
      e.type !== null &&
      e.type.restriction === "connector"
    ) {
      out.push(e);
    }
  }
  return out;
}

/**
 * `parameter` variables declared directly on `mi`. Identified by
 * `prefixes.variability === "parameter"`. Includes parameters whose
 * `type` is a primitive string (`"Real"`, `"Boolean"`, …) and those
 * whose `type` is a `type`-restricted ModelInstance (SI unit aliases),
 * since both can carry default values worth substituting.
 *
 * Used by the producer to populate `ClassDef.parameters` for the
 * `%<paramName>` text-substitution fallback.
 */
export function ownParameters(mi: ModelInstance): ComponentElement[] {
  const out: ComponentElement[] = [];
  for (const e of ownComponents(mi)) {
    if (e.prefixes?.variability === "parameter") out.push(e);
  }
  return out;
}

/**
 * Convenience: yield every `extends`-element directly on `mi` (not
 * recursive). Used by some callers to read the immediate parent chain.
 */
export function ownExtendsElements(mi: ModelInstance): ElementNode[] {
  const out: ElementNode[] = [];
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends") out.push(e);
  }
  return out;
}

/**
 * Inheritance-aware connector collection: walks the extends chain in
 * post-order and yields each connector together with the qualified name
 * of the class that declared it. If the same connector name appears at
 * multiple levels (rare — would mean a redeclare), the LATER yield (the
 * more-derived class) wins per Modelica override semantics; callers that
 * key by name should overwrite on collision.
 */
export function* walkConnectors(
  mi: ModelInstance,
): Iterable<{ from: string; element: ComponentElement }> {
  for (const klass of walkExtendsChain(mi)) {
    for (const e of ownConnectors(klass)) {
      yield { from: klass.name, element: e };
    }
  }
}
