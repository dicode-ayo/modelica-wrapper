/**
 * Helper for turning `getInstantiatedParametersAndValues`'s output
 * (`["k = 1.0", "Ti = 0.5", ...]`) into the flat
 * `paramName → displayValue` map carried on `DiagramLayout` for
 * label `%`-substitutions.
 *
 * This map is for display only. Gating and graphic fields resolve
 * against `modelInstanceScope`, built from the `getModelInstance` tree
 * itself: OMC reduces `if`-conditions to a literal but leaves the
 * equivalent expressions in graphic annotations unreduced, so reading
 * either from a display-string map would lose the type. The form-side
 * Dialog.enable evaluator is separate again — it evaluates against the
 * user's in-progress working values, which OMC never sees.
 *
 * OMC emits each row as `<name> = <value>`. The `name` is a dotted
 * path (top-level params usually have no dot); the `value` is whatever
 * OMC reduced the binding to — a number, boolean, qualified enum, or
 * string literal. Anything OMC couldn't reduce comes through as the
 * source expression text; we surface it raw so callers can decide
 * whether to display it or fall back.
 */

/**
 * Parse the array OMC returns into a flat `name → display-string` map.
 *
 * Splits each row on the FIRST ` = ` (with the surrounding spaces). A
 * value that itself contains ` = ` (rare; happens when the binding is
 * a record literal) keeps the inner ` = ` intact. Rows OMC emits
 * malformed-looking (no separator) are skipped — the caller treats
 * the absence of a key as "fall back to whatever you'd use otherwise".
 */
export function parseInstantiatedParameters(
  rows: ReadonlyArray<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const eq = row.indexOf(" = ");
    if (eq < 0) continue;
    const name = row.slice(0, eq).trim();
    const value = row.slice(eq + 3).trim();
    if (name.length === 0) continue;
    out[name] = value;
  }
  return out;
}
