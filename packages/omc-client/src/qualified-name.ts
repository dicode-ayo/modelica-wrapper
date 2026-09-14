/**
 * Splitting a dotted Modelica name at its trailing segment.
 *
 * `lang-core` exports the same split, but reaching it means depending on that
 * package's root barrel and the tree-sitter runtime behind it. This package
 * carries only zeromq and zod, and every consumer would inherit the parser.
 */

/**
 * `qualified` minus its trailing segment, or `""` when it has only one.
 *
 * The split skips a quoted identifier (Modelica spec §2.3.1), which may itself
 * contain a `.` — `A.'b.c'` encloses to `A`, not to `A.'b`.
 */
export function enclosingScope(qualified: string): string {
  let cut = -1;
  for (let i = 0; i < qualified.length; i++) {
    const c = qualified[i];
    if (c === "'") {
      // Skip to the closing quote so a dot inside it never splits the name.
      i++;
      while (i < qualified.length && qualified[i] !== "'") {
        if (qualified[i] === "\\") i++;
        i++;
      }
    } else if (c === ".") cut = i;
  }
  return cut === -1 ? "" : qualified.slice(0, cut);
}
