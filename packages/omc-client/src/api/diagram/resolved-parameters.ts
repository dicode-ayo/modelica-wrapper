/**
 * Helpers for turning `getInstantiatedParametersAndValues`'s output
 * (`["k = 1.0", "Ti = 0.5", ...]`) into the shapes the diagram producer
 * and downstream consumers (port visibility, label substitution,
 * Dialog.enable) need.
 *
 * OMC emits each row as `<name> = <value>`. The `name` is a dotted path
 * (top-level params usually have no dot); the `value` is whatever OMC
 * reduced the binding to — an integer / real / boolean literal, a
 * qualified enum name, or a string literal. Anything OMC couldn't
 * reduce comes through as the source expression text; we surface it
 * raw so callers can decide whether to display it or fall back.
 */

import type { EvalScope, EvalValue } from "../../eval/expression-evaluator.js";
import { recordScope } from "../../eval/scope.js";

/**
 * Parse the array OMC returns into a flat `name → display-string` map.
 *
 * Splits each row on the FIRST ` = ` (with the surrounding spaces). A
 * value that itself contains ` = ` (rare; happens when the binding is
 * a record literal) keeps the inner ` = ` intact. Rows OMC emits
 * malformed-looking (no separator) are skipped — the caller treats the
 * absence of a key as "fall back to whatever you'd use otherwise".
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

/**
 * Coerce a display-string value into an `EvalValue` the expression
 * evaluator can compare / arithmetic against.
 *
 * The heuristics:
 *  - `"true"` / `"false"` → boolean
 *  - looks-like-a-number → number
 *  - quoted Modelica string → unquoted string
 *  - a single dotted Modelica identifier (`Foo.Bar.PI`) → tagged enum
 *    literal (`{$kind:"enum", name:"..."}`) so equality against a
 *    qualified enum literal in the expression works without the caller
 *    knowing the type up-front
 *  - anything else (raw expression text OMC couldn't reduce) → raw
 *    string. The evaluator treats this as "unresolved" for most ops,
 *    which is what we want — Dialog.enable falls back to "enabled",
 *    conditional ports fall back to "visible".
 */
export function coerceInstantiatedValue(raw: string): EvalValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Numeric literal: optional sign + digits + optional decimal + optional exponent.
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  // Qualified enum literal like `Modelica.Blocks.Types.Init.InitialState`.
  // The conservative rule: at least one dot, every segment a Modelica
  // identifier (`[A-Za-z_][A-Za-z0-9_]*`). No spaces, no operators.
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(raw)) {
    return { $kind: "enum", name: raw };
  }
  return raw;
}

/**
 * Build the `EvalScope` callers pass into `evaluateExpression` for
 * port-visibility and conditional-component checks. The scope reads
 * top-level keys only — nested dotted lookups (`sub.k`) return
 * `undefined`, matching how `getInstantiatedParametersAndValues`
 * flattens its output (each row is a top-level param of the host class).
 */
export function instantiatedParametersScope(
  rows: ReadonlyArray<string> | Record<string, string>,
): EvalScope {
  const map = Array.isArray(rows)
    ? parseInstantiatedParameters(rows)
    : (rows as Record<string, string>);
  const values: Record<string, EvalValue> = {};
  for (const [name, raw] of Object.entries(map)) {
    // Skip nested keys here: only top-level identifiers participate.
    if (name.includes(".")) continue;
    values[name] = coerceInstantiatedValue(raw);
  }
  return recordScope(values);
}
