import type {
  ClassDef,
  ComponentInstance,
  Modifier,
} from "@dicode/omc-client";
import type { TextSubstitutions } from "@dicode/diagram-svg";

/**
 * Build the `TextSubstitutions` record for one component instance,
 * suitable for `<om-component>.substitutions` (which republishes it
 * via Lit context to descendant `<om-text>` / `<om-label>` elements).
 *
 * Layering (last write wins):
 *  1. `cls.parameters[name].value` — class-level defaults (walked
 *     through the extends chain by the producer; later-declared wins).
 *  2. `hostResolvedParameters[<instance.name>.<paramName>]` — OMC's
 *     instantiation-reduced value when the host class chose to bind
 *     this sub-component's parameter from an outer cref (e.g. the
 *     host's `freq` driving the sub-component's `frequency`). Only
 *     applied when the host actually has a row for that nested path,
 *     so simple components keep showing the type's default instead of
 *     blanking when the host doesn't address the sub-param.
 *  3. `instance.modifiers[name]` — per-instance literal overrides
 *     from the model source; merged on top of the host-resolved layer.
 *
 * `%name` resolves to `instance.name`, `%class` to `instance.classRef`.
 * For a vector / matrix component, the array dimensions are appended to
 * `%name` Modelica-style — `pins` with `dims: ["3"]` renders as `pins[3]`,
 * `grid` with `dims: ["2", "4"]` as `grid[2, 4]` — matching OMEdit's
 * `TextAnnotation` (`name.append("[" + typedDims.join(", ") + "]")`).
 * Unknown `%<paramName>` tokens fall through to `""` inside the
 * interpolator — see `interpolateTemplate` for the rationale.
 */
export function buildSubstitutions(
  instance: ComponentInstance,
  cls: ClassDef | undefined,
  hostResolvedParameters?: Record<string, string>,
): TextSubstitutions {
  const parameters: Record<string, string> = {};
  if (cls?.parameters) {
    for (const [name, def] of Object.entries(cls.parameters)) {
      parameters[name] = def.value;
    }
  }
  if (hostResolvedParameters !== undefined) {
    const prefix = `${instance.name}.`;
    for (const [key, value] of Object.entries(hostResolvedParameters)) {
      if (key.startsWith(prefix)) {
        parameters[key.slice(prefix.length)] = value;
      }
    }
  }
  const overrides = topLevelModifierMap(instance.modifiers);
  for (const [name, value] of Object.entries(overrides)) {
    parameters[name] = value;
  }
  appendUnits(parameters, cls);
  return {
    name: nameWithDims(instance.name, instance.dims),
    class: instance.classRef,
    parameters,
  };
}

/**
 * Append each parameter's declared `unit` to its FINAL display value,
 * mirroring OMEdit's `TextAnnotation` (`%param` tokens whose resolved value
 * is a literal constant get the unit appended — `1e4` → `1e4 N.m/rad`).
 *
 * This runs after every overlay (class default → host-resolved → instance
 * modifier) so the actually-shown value is annotated. That matters because
 * the common case — `spring(c=1e4, d=100)` — supplies the value as an
 * INSTANCE MODIFIER, which the host-side `applyDisplayUnits` (open-diagram's
 * `fetchLayout`) never reaches: it only rewrites class defaults.
 *
 * Only literal-numeric values are touched (OMEdit's `isValueLiteralConstant`
 * guard) — expressions, enums, crefs and blanks pass through. The original
 * literal text is preserved (`1e4` stays `1e4`, not `10000`); we only suffix
 * the unit. The dimensionless placeholder `unit=="1"` is skipped.
 *
 * The displayUnit→unit CONVERSION (e.g. `rad`→`deg`) needs OMC and stays on
 * the host: it pre-rewrites converted class defaults to a non-numeric string
 * like `"90 deg"`, which fails the numeric guard here and is left untouched —
 * so the two paths never double-annotate.
 *
 * KNOWN LIMITATION — a `displayUnit` parameter whose value comes from an
 * INSTANCE MODIFIER shows its SOURCE unit, not the converted display unit.
 * This webview path is synchronous and has no `OmcClient`, so it cannot call
 * `convertUnits`; only the host-side `applyDisplayUnits` (open-diagram's
 * `fetchLayout`) converts, and it rewrites CLASS DEFAULTS only. When an
 * instance modifier overlays the class default here (the overlay above runs
 * AFTER the host pass), the converted `"90 deg"` is replaced by the raw
 * `1.57`, so `appendUnits` suffixes the honest source `unit` and the label
 * reads `1.57 rad` rather than OMEdit's `90 deg`. Intentional: with no OMC
 * webview-side, showing the true source unit beats mislabelling a raw value
 * with a unit it was never converted into. See the host `display-unit.ts`
 * `applyDisplayUnits` doc for the conversion half.
 */
function appendUnits(
  parameters: Record<string, string>,
  cls: ClassDef | undefined,
): void {
  if (!cls?.parameters) return;
  for (const [name, def] of Object.entries(cls.parameters)) {
    const value = parameters[name];
    if (value === undefined) continue;
    const unit = def.unit?.trim();
    if (!unit || unit === "1") continue;
    if (parseNumeric(value) === undefined) continue;
    parameters[name] = `${value.trim()} ${unit}`;
  }
}

/**
 * Parse a display string as a finite number — the gate for "is this a literal
 * constant we should annotate". The WHOLE trimmed string must be the number
 * (via `Number(...)`, not `parseFloat`) so `"1.5 + x"` or an already-annotated
 * `"1 kg.m2"` return `undefined` and pass through untouched.
 */
function parseNumeric(s: string): number | undefined {
  const t = s.trim();
  if (t.length === 0) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Append a Modelica-shaped array-dimension suffix to a component name.
 * `("pins", ["3"])` → `"pins[3]"`; `("grid", ["2", "4"])` → `"grid[2, 4]"`.
 * A scalar component (`dims` absent or empty) returns the name unchanged.
 * Mirrors OMEdit's `getTypedDimensionsString()` which joins with `", "`.
 */
function nameWithDims(name: string, dims: string[] | undefined): string {
  if (dims === undefined || dims.length === 0) return name;
  return `${name}[${dims.join(", ")}]`;
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
