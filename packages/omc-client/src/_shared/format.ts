/**
 * Modelica command-string formatting helpers used by API functions to build
 * the `OmcCommand` strings sent over the ZMQ transport.
 *
 * `quote` defends a string argument by escaping it. An argument OMC wants
 * unquoted cannot be defended that way, so the grammar it must satisfy lives
 * here too — `MODELICA_NAME` and `expressionFault` — and `_shared/fields.ts`
 * enforces them on the input schemas, which every call is parsed against.
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
 * pass an empty array (deltaSimulationResults, diffSimulationResults).
 */
export function quoteListOrFillEmpty(items: string[]): string {
  if (items.length === 0) return 'fill("", 0)';
  return "{" + items.map(quote).join(", ") + "}";
}

/** `true` / `false` */
export function mlBool(b: boolean): string {
  return b ? "true" : "false";
}

/**
 * Modelica name grammar, as OMC's scripting parser reads an argument emitted
 * without quotes: dot-separated segments, each an IDENT or a Q-IDENT, each
 * optionally subscripted.
 *
 * A Q-IDENT lexes as one token, so a `.` or a `)` inside one is inert and the
 * pattern admits it. Subscripts admit integers, ranges and the dimension
 * separator — every subscript a cref reaching OMC carries (`pins[3].p`,
 * `a[1, 2]`).
 */
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const QIDENT = "'(?:[^'\\\\]|\\\\.)+'";
const SUBSCRIPT = "(?:\\[[0-9,:\\s]+\\])?";
const SEGMENT = `(?:${IDENT}|${QIDENT})${SUBSCRIPT}`;
export const MODELICA_NAME = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`);

/** Bracket kind opened, keyed by the character that closes it. */
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Why `s` would leave the argument position it is interpolated into, or
 * `undefined` if it stays put.
 *
 * An annotation or modifier value is an arbitrary expression, so no pattern as
 * narrow as {@link MODELICA_NAME} fits it. What it must not do is leave the
 * argument position it is interpolated into: brackets stay balanced, and a
 * separator or comment marker that would end the argument or the call cannot
 * appear outside a string literal.
 */
export function expressionFault(s: string): string | undefined {
  let fault: string | undefined;
  const reject = (why: string): void => {
    fault ??= why;
  };
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== OPENER[c]) reject("closes a bracket it did not open");
    } else if (c === "," || c === ";") {
      if (stack.length === 0) reject("separates arguments at the top level");
    } else if (
      c === "/" &&
      (s.charAt(i + 1) === "/" || s.charAt(i + 1) === "*")
    ) {
      reject("comments out the rest of the command");
    }
  }
  if (inString) reject("leaves a string literal open");
  if (stack.length > 0) reject("leaves a bracket open");
  return fault;
}
