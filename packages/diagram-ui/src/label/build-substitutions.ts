import type {
  ClassDef,
  ComponentInstance,
  Modifier,
} from "@modelica-wrapper/omc-client";
import type { TextSubstitutions } from "@modelica-wrapper/diagram-svg";

/**
 * Build the `TextSubstitutions` record for one component instance,
 * suitable for `<om-component>.substitutions` (which republishes it
 * via Lit context to descendant `<om-text>` / `<om-label>` elements).
 *
 * Layering:
 *  1. `cls.parameters[name].value` — class-level defaults (walked
 *     through the extends chain by the producer; later-declared wins).
 *  2. `instance.modifiers[name]` — per-instance overrides; flattened
 *     to a display string and merged on top of the defaults.
 *
 * `%name` resolves to `instance.name`, `%class` to `instance.classRef`.
 * Unknown `%<paramName>` tokens fall through to `""` inside the
 * interpolator — see `interpolateTemplate` for the rationale.
 */
export function buildSubstitutions(
  instance: ComponentInstance,
  cls: ClassDef | undefined,
): TextSubstitutions {
  const parameters: Record<string, string> = {};
  if (cls?.parameters) {
    for (const [name, def] of Object.entries(cls.parameters)) {
      parameters[name] = def.value;
    }
  }
  const overrides = topLevelModifierMap(instance.modifiers);
  for (const [name, value] of Object.entries(overrides)) {
    parameters[name] = value;
  }
  return {
    name: instance.name,
    class: instance.classRef,
    parameters,
  };
}

/**
 * Flatten the top level of a per-instance modifier into a
 * `paramName → display string` map. Nested modifiers — e.g.
 * `phase.start = 1` for a sub-component parameter — are ignored at
 * this layer because the text-substitution syntax only addresses the
 * component's own parameter names. Each value collapses via the same
 * `$value`-walking rule the producer uses for the class-level
 * `value.binding` fallback.
 */
function topLevelModifierMap(
  mod: Modifier | undefined,
): Record<string, string> {
  if (mod === undefined || mod === null) return {};
  if (typeof mod !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(mod)) {
    const s = flattenToDisplay(value);
    if (s.length > 0) out[name] = s;
  }
  return out;
}

function flattenToDisplay(mod: Modifier | undefined): string {
  if (mod === undefined || mod === null) return "";
  if (typeof mod === "string") return mod;
  if (typeof mod === "number" || typeof mod === "boolean") return String(mod);
  if (typeof mod === "object" && "$value" in mod) {
    return flattenToDisplay(mod.$value);
  }
  return "";
}
