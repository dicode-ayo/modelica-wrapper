/**
 * Turn OMC's most confusing error string into an actionable hint.
 *
 * Today this covers one case — but it's the case every Modelica REPL user
 * hits within their first ten minutes:
 *
 *   omc> getElementAnnotation("Modelica.Blocks.Examples.PID_Controller")
 *   error: [<interactive>:1:1-1:0:writable] Error: Class
 *          getElementAnnotation not found in scope <global scope>
 *          (looking for a function or record).
 *
 * The function isn't actually missing. OMC's overload resolver couldn't
 * find a `getElementAnnotation(String)` because the real signature is
 * `getElementAnnotation(TypeName)` — and quoting the argument turned it
 * into a String. The reported error is technically correct for OMC's
 * symbol-table lookup but reads to the user like "the function doesn't
 * exist", which is wrong and discouraging.
 *
 * `diagnoseOmcError(line, errorString)` recognises this pattern and
 * returns a hint string for the REPL to prepend. If we can extract a
 * quoted dotted-identifier from the call, we also propose the corrected
 * line with the quotes stripped.
 *
 * Keep the heuristic conservative: only fire when the bare name in the
 * error message exactly matches a registered OMC function. Otherwise we'd
 * risk shadowing a legitimate "class FOO not found" message about a model
 * the user really did mistype.
 */

import { REGISTRY, type OmcFnName } from "@dicode/omc-client";

const LOOKUP_FAILURE_RE =
  /Class\s+([A-Za-z_]\w*)\s+not found in scope\s+<[^>]+>\s+\(looking for a function or record\)/;

/** Regex that matches a quoted dotted Modelica identifier inside a call. */
const QUOTED_DOTTED_RE = /"([A-Za-z_][\w.]*(?:\.[A-Za-z_]\w*)*)"/;

export function diagnoseOmcError(
  rawLine: string,
  errorString: string,
): string | undefined {
  const m = LOOKUP_FAILURE_RE.exec(errorString);
  if (!m) return undefined;
  const fnName = m[1]!;
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, fnName)) {
    // Some genuinely missing class — leave OMC's error alone.
    return undefined;
  }

  const lines: string[] = [
    `hint: \`${fnName}\` exists, but OMC could not match any overload for the argument types you passed.`,
  ];

  // The most common cause by far: a Modelica TypeName argument was quoted.
  // Try to find a `"X.Y.Z"` token in the user's line and propose unquoting.
  const q = QUOTED_DOTTED_RE.exec(rawLine);
  if (q && q[1] && q[1].includes(".")) {
    const fixed = rawLine.replace(q[0], q[1]);
    lines.push(
      `      Modelica TypeName arguments are passed bare (no quotes). Try:`,
    );
    lines.push(`        ${fixed.trim()}`);
  } else {
    lines.push(
      `      Modelica TypeName arguments must be passed bare (unquoted dotted name).`,
    );
  }
  return lines.join("\n");
}

/** Exported only for tests — exposes the typed name guard. */
export function isRegisteredFunction(name: string): name is OmcFnName {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}
