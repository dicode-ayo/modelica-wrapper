/**
 * Modelica `%`-substitution for text label templates.
 *
 * Modelica icons routinely embed `%name`, `%class`, or `%<paramName>`
 * tokens in their `TextShape.textString` (e.g. SpringDamper's
 * `"d=%d"` / `"c=%c"` / `"%name"`). The renderer needs the resolved
 * string before drawing — there's no glyph for `%d`.
 *
 * Predefined identifiers:
 *   - `%name`  → the component instance's name (e.g. `springdamper1`)
 *   - `%class` → the component's class (e.g.
 *                `Modelica.Mechanics.Rotational.Components.SpringDamper`)
 *
 * Any other `%<ident>` resolves against `substitutions.parameters` —
 * a `paramName → display string` map. Per-instance modifier overrides
 * are expected to be merged into that map by the caller, on top of the
 * class's parameter defaults (`ClassDef.parameters[name].value`).
 *
 * Escapes:
 *   - `%%` → literal `%`
 *
 * Unknown tokens (no matching parameter, no predefined meaning) resolve
 * to the empty string, matching OMEdit's behaviour — we'd rather show
 * `d=` for a missing value than the raw `d=%d` template.
 *
 * Shared between the SVG renderer (`diagram-svg`) and the Babylon
 * `<om-text>` primitive (`diagram-ui`) so both renderers stay in sync
 * on substitution semantics. The helper has no DOM / Babylon
 * dependencies on purpose.
 */

export interface TextSubstitutions {
  /** Component instance name; resolved value for `%name`. */
  name?: string | undefined;
  /** Fully-qualified class name; resolved value for `%class`. */
  class?: string | undefined;
  /**
   * Display strings keyed by parameter name. Callers should build this
   * from `ClassDef.parameters[name].value` (defaults) overlaid with
   * `ComponentInstance.modifiers` (per-instance overrides).
   */
  parameters?: Record<string, string> | undefined;
}

// Greedy identifier match so `%nameSuffix` is read as the single token
// `nameSuffix`, not `name` + literal `Suffix`. `%` and `%%` are handled
// explicitly. Identifier rules follow Modelica IDENT (`[A-Za-z_][A-Za-z0-9_]*`).
const TOKEN_RE = /%(%|[A-Za-z_][A-Za-z0-9_]*)/g;

export function interpolateTemplate(
  template: string,
  substitutions: TextSubstitutions,
): string {
  return template.replace(TOKEN_RE, (_full, token: string) => {
    if (token === "%") return "%";
    if (token === "name") return substitutions.name ?? "";
    if (token === "class") return substitutions.class ?? "";
    return substitutions.parameters?.[token] ?? "";
  });
}
