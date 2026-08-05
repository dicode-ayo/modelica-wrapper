/**
 * Declaration-unit resolution over a `ModelInstance`, plus the modifier
 * readers it is built from. Shared by the diagram producer (which prints the
 * unit in a label) and the parameters-form producer (which offers it as the
 * field's base unit) — the two must never disagree about one declaration.
 */

import type {
  ComponentElement,
  Modifier,
  ModelInstance,
} from "./modelInstance.js";

/**
 * Guards against a malformed `baseClass` tree. Modelica forbids inheritance
 * cycles and OMC rejects them upstream, so no well-formed reply reaches it.
 */
const MAX_EXTENDS_DEPTH = 16;

/**
 * Flatten a `Modifier` tree to a display string, walking `$value` so a
 * structured `{min: "0", $value: "1"}` collapses to `"1"`. Unsupported and
 * missing shapes yield `""`, so a caller can fall through to its next source
 * without special-casing them.
 */
export function modifierToDisplayString(mod: Modifier | undefined): string {
  if (mod === undefined || mod === null) return "";
  if (typeof mod === "string") return mod;
  if (typeof mod === "number" || typeof mod === "boolean") return String(mod);
  if (typeof mod === "object" && "$value" in mod) {
    return modifierToDisplayString(mod.$value);
  }
  return "";
}

/**
 * Read a named field (`unit`, `displayUnit`, …) off a `Modifier` record,
 * flattening through a `$value` wrapper. The result is still quoted as OMC
 * emitted it; `undefined` when the field is absent or flattens to `""`.
 */
function readModifierField(
  mod: Modifier | undefined,
  field: string,
): string | undefined {
  if (mod === undefined || mod === null || typeof mod !== "object") {
    return undefined;
  }
  const s = modifierToDisplayString((mod as Record<string, Modifier>)[field]);
  return s.length > 0 ? s : undefined;
}

/**
 * OMC emits string-typed modifier bindings with their Modelica quotes
 * (`"\"rad\""`) — drop one layer so consumers see `rad`, not `"rad"`.
 */
export function unquoteString(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * The declaration `unit` of a parameter component, or `undefined`.
 *
 * The component's own modifier wins (`Real x(unit="m")`); otherwise the unit
 * rides on a type alias's `extends Real(unit=…)`, which OMC inlines as a
 * nested `ModelInstance` on each `extends` element's `baseClass`.
 *
 * Traversal contract — mirrors OMEdit's `Element::getModifierValueFromType` /
 * `getModifierValueFromInheritedType` (`OMEdit/OMEditLIB/Modeling/Model.cpp`):
 * depth-first over EVERY `extends` element in declaration order, taking each
 * clause's own modifier before descending into its base class, and
 * backtracking into the next clause when a branch yields nothing. A unit
 * behind a second `extends` clause therefore resolves the same as one behind
 * the first. Depth is bounded at {@link MAX_EXTENDS_DEPTH}.
 */
export function resolveUnit(el: ComponentElement): string | undefined {
  const direct = readModifierField(el.modifiers, "unit");
  if (direct !== undefined) return unquoteString(direct);
  if (typeof el.type !== "object") return undefined;
  return unitFromInstance(el.type, 0);
}

function unitFromInstance(
  mi: ModelInstance,
  depth: number,
): string | undefined {
  if (depth > MAX_EXTENDS_DEPTH) return undefined;
  for (const child of mi.elements ?? []) {
    if (child.$kind !== "extends") continue;
    const own = readModifierField(child.modifiers, "unit");
    if (own !== undefined) return unquoteString(own);
    const base = child.baseClass;
    if (typeof base === "object") {
      const nested = unitFromInstance(base, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/**
 * The `displayUnit` of a parameter component (`Angle phi(displayUnit="deg")`),
 * or `undefined`. Read off the component's own modifier only — unlike the
 * declaration `unit`, it is a use-site choice, not a property of the type.
 */
export function resolveDisplayUnit(el: ComponentElement): string | undefined {
  const direct = readModifierField(el.modifiers, "displayUnit");
  return direct === undefined ? undefined : unquoteString(direct);
}
