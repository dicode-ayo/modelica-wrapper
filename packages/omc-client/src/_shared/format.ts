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

/** `true` / `false` */
export function mlBool(b: boolean): string {
  return b ? "true" : "false";
}
