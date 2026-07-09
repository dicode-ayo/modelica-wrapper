/**
 * Splitting a dotted class name into its trailing segment and enclosing
 * scope. A segment may be a quoted identifier (Q-IDENT, Modelica spec
 * §2.3.1) that itself contains a `.` — e.g. `Complex.'-'.negate` or
 * `Pkg.'a.b'` — so a plain `lastIndexOf(".")` splits inside the quotes.
 * These scan backwards for the separating dot while skipping over any
 * `'...'` run (respecting `\'`/`\\` escapes), mirroring the forward scan
 * `readDottedName` already does in `omc-client`'s parser.
 */

/**
 * Index of the dot that separates `name`'s trailing segment from its
 * enclosing scope, or `-1` if `name` has no such dot. Dots inside a quoted
 * (`'...'`) segment are not candidates.
 */
export function lastUnquotedDotIndex(name: string): number {
  let lastDot = -1;
  let i = 0;
  while (i < name.length) {
    if (name[i] === "'") {
      i++;
      while (i < name.length) {
        if (name[i] === "\\" && i + 1 < name.length) {
          i += 2;
          continue;
        }
        if (name[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (name[i] === ".") lastDot = i;
    i++;
  }
  return lastDot;
}

/** Trailing dotted segment of `qualified`, falling back to the whole name. */
export function leafName(qualified: string): string {
  const dot = lastUnquotedDotIndex(qualified);
  return dot === -1 ? qualified : qualified.slice(dot + 1);
}

/**
 * Enclosing scope of a dotted class name, or `""` for a top-level (or
 * unqualified) name. `Pkg.Sub.Foo` -> `Pkg.Sub`; `Foo` -> `""`.
 */
export function enclosingScope(qualified: string): string {
  const dot = lastUnquotedDotIndex(qualified);
  return dot === -1 ? "" : qualified.slice(0, dot);
}
