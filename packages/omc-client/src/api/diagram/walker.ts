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
 * Walk a class and its inheritance chain in post-order.
 *
 * For a host class `C` extending `B` extending `A`, the iteration yields
 * `A`, `B`, `C` in that order. Cycles are not handled — Modelica forbids
 * inheritance cycles, and OMC would already reject them upstream.
 */
export function* walkExtendsChain(
  mi: ModelInstance,
  directBase?: string,
): Iterable<ExtendsChainNode> {
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends" && typeof e.baseClass === "object") {
      yield* walkExtendsChain(e.baseClass, directBase ?? e.baseClass.name);
    }
  }
  yield { klass: mi, directBase };
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
 * Inheritance-aware layer collection: walks the extends chain in post-order,
 * yielding each class together with whether its graphics primitives should be
 * rendered.
 *
 * `primitivesVisible` is false when an `extends` annotation carries
 * `IconMap(primitivesVisible=false)` (for `kind="icon"`) or
 * `DiagramMap(primitivesVisible=false)` (for `kind="diagram"`). Suppression
 * propagates: if a parent's `extends` annotation hides primitives, all deeper
 * ancestor layers are hidden too.
 *
 * The host class's own primitives are always visible (Modelica spec §18.6.3:
 * `primitivesVisible` only applies to the referenced base class, not the
 * extends-ing class itself).
 */
export function* walkLayerEntries(
  mi: ModelInstance,
  kind: "icon" | "diagram",
): Iterable<{ klass: ModelInstance; primitivesVisible: boolean }> {
  const mapKey = kind === "icon" ? "IconMap" : "DiagramMap";
  for (const e of mi.elements ?? []) {
    if (e.$kind !== "extends" || typeof e.baseClass !== "object") continue;
    const rawMap = e.annotation?.[mapKey];
    const primitivesVisible = !(
      typeof rawMap === "object" &&
      rawMap !== null &&
      (rawMap as { primitivesVisible?: unknown }).primitivesVisible === false
    );
    for (const entry of walkLayerEntries(e.baseClass, kind)) {
      yield {
        klass: entry.klass,
        primitivesVisible: primitivesVisible && entry.primitivesVisible,
      };
    }
  }
  yield { klass: mi, primitivesVisible: true };
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
  for (const { klass } of walkExtendsChain(mi)) {
    for (const e of ownConnectors(klass)) {
      yield { from: klass.name, element: e };
    }
  }
}
