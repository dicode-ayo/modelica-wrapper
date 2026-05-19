/**
 * Helper for turning `getInstantiatedParametersAndValues`'s output
 * (`["k = 1.0", "Ti = 0.5", ...]`) into the flat
 * `paramName → displayValue` map carried on `DiagramLayout` for
 * label `%`-substitutions.
 *
 * Earlier revisions also exposed `EvalScope` / `EvalValue` helpers
 * (`coerceInstantiatedValue`, `instantiatedParametersScope`) for the
 * producer's component / port gating path. Those were dropped once
 * we confirmed OMC's `getModelInstance` pre-reduces every `if`-
 * condition to a literal — see `producer.ts:isConditionTrue` for the
 * trace. The form-side Dialog.enable evaluator stays put (it
 * evaluates against the user's in-progress working values, which OMC
 * doesn't see).
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
