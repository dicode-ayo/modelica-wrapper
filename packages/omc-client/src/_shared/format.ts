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
 * Render a numeric argument.
 *
 * `NaN` and the infinities stringify to identifiers OMC resolves as names,
 * so they reach the parser as a command that is not the one asked for.
 */
export function num(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(
      `not a finite number, so OMC would read it as a name: ${n}`,
    );
  }
  return `${n}`;
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
const NAME = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`);

/**
 * Return `s` if it is a Modelica name, else throw.
 *
 * OMC wants TypeName and component-reference arguments unquoted, so `quote`
 * cannot defend them: whatever they contain reaches the parser as command
 * text, and a `)` in one closes the call and starts another.
 */
export function bareName(s: string): string {
  if (!NAME.test(s)) {
    throw new Error(
      `not a Modelica name, so it cannot be sent to OMC unquoted: ${JSON.stringify(s)}`,
    );
  }
  return s;
}

/** Bracket kind opened, keyed by the character that closes it. */
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Return `s` if it is a self-contained Modelica expression, else throw.
 *
 * Annotation and modifier-value arguments are arbitrary expressions, so no
 * grammar as narrow as {@link bareName} fits them. What they must not do is
 * leave the argument position they are interpolated into: brackets stay
 * balanced, and a separator that would end the argument or the call cannot
 * appear outside a string literal.
 */
export function bareExpr(s: string): string {
  const reject = (why: string): never => {
    throw new Error(
      `${why}, so it cannot be sent to OMC as a command argument: ${JSON.stringify(s)}`,
    );
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
  return s;
}
