/**
 * Helper for turning `getInstantiatedParametersAndValues`'s output
 * (`["k = 1.0", "Ti = 0.5", ...]`) into the flat
 * `paramName → displayValue` map carried on `DiagramLayout` for
 * label `%`-substitutions.
 *
 * This module stays narrowly scoped to the label-substitution map. The
 * producer's component/port gating (`producer.ts:isConditionTrue`) and its
 * graphic-annotation field decoding (`shapes.ts`) evaluate against an
 * `EvalScope` built directly from the `ModelInstance` tree
 * (`eval-scope.ts:scopeForInstance`) rather than this parsed map — OMC
 * pre-reduces `if`-conditions to a literal in the cases checked, but not
 * graphic fields like `visible`/`rotation`/`fillColor`, and `isConditionTrue`
 * evaluates rather than assumes pre-reduction either. The form-side
 * Dialog.enable evaluator is a separate `EvalScope` again (it evaluates
 * against the user's in-progress working values, which OMC doesn't see).
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
