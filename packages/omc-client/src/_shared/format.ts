/**
 * Modelica command-string formatting helpers used by API functions to build
 * the `OmcCommand` strings sent over the ZMQ transport.
 */

/** Wrap s as a Modelica string literal, escaping the necessary characters. */
export function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    switch (c) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\r":
        out += "\\r";
        break;
      default:
        out += c;
    }
  }
  out += '"';
  return out;
}

/** Render a Modelica list literal of strings: `{"a", "b", "c"}`. */
export function quoteList(items: string[]): string {
  if (items.length === 0) return "{}";
  return "{" + items.map(quote).join(", ") + "}";
}

/**
 * Render a Modelica `String[:]` literal, but emit `fill("", 0)` for the
 * empty case instead of `{}`.
 *
 * Why: OMC's interactive scripting parser does not accept the bare empty
 * brace literal `{}` for a `String[:]` argument — it tries to resolve it
 * as a name and fails, producing the misleading "Class <fn> not found in
 * scope" diagnostic that masks the real issue (see `docs/audit.md` §2.10).
 * `fill("", 0)` is the canonical empty-array literal OMC's docs use for
 * the same default, and it round-trips through the interactive RPC.
 *
 * Use this for any wrapper whose OMC signature declares
 * `input String[:] vars = fill("", 0)` and whose caller may legitimately
 * pass an empty array (compareSimulationResults, deltaSimulationResults,
 * diffSimulationResults).
 */
export function quoteListOrFillEmpty(items: string[]): string {
  if (items.length === 0) return 'fill("", 0)';
  return "{" + items.map(quote).join(", ") + "}";
}

/** `true` / `false` */
export function mlBool(b: boolean): string {
  return b ? "true" : "false";
}
