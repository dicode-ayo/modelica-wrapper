import { ZodError } from "zod";

/**
 * Lines/characters of error text a tool reply keeps before eliding the rest.
 * OMC's own diagnostics run at most a few lines; the one thing this needs to
 * stop is a whole-library dump — OMC's "the available classes were: ..."
 * listing every loaded class — reaching an MCP client as a multi-hundred-KB
 * reply for one refused call.
 */
const MAX_ERROR_LINES = 60;
const MAX_ERROR_CHARS = 4000;

/**
 * Keeps `text`'s head and elides the remainder, noting how much was cut.
 *
 * The line cap and the character cap both have to hold: a reply within
 * `MAX_ERROR_LINES` can still be huge if those few lines are each long (a
 * class dump that wraps long qualified names onto few lines), so the char
 * cap is applied to whatever the line cap leaves rather than skipped
 * whenever the line cap didn't fire.
 */
function capErrorText(text: string): string {
  const lines = text.split("\n");
  const byLines =
    lines.length > MAX_ERROR_LINES
      ? `${lines.slice(0, MAX_ERROR_LINES).join("\n")}\n...\n[+${lines.length - MAX_ERROR_LINES} more lines elided]`
      : text;
  if (byLines.length <= MAX_ERROR_CHARS) return byLines;
  const elided = text.length - MAX_ERROR_CHARS;
  return `${text.slice(0, MAX_ERROR_CHARS)}\n...\n[+${elided} more characters elided]`;
}

/**
 * The message of a caught `unknown`, without assuming it's an `Error`.
 *
 * A `ZodError` from `OmcClient.invoke`'s input validation renders as one line
 * per issue — the argument path and the schema's own message — dropping
 * `code`/`format`/`pattern` and the rest of zod's bookkeeping. `fnName`, when
 * given, prefixes each path so the line names the call the argument belonged
 * to.
 *
 * The result is always capped (`capErrorText`), so a refusal that came back
 * as hundreds of KB of OMC prose gets cut down to size wherever a caller
 * routes it through here. Not every tool error does: a hand-built refusal
 * string (a write-gate refusal, an unknown-function message) is short by
 * construction and returned straight to `errorResult` without this. Route a
 * new raw OMC reason (`getErrorString` text, a caught error's `.message`)
 * through `errorDetail` rather than straight to `errorResult` — that's what
 * keeps the cap ahead of it.
 */
export function errorDetail(err: unknown, fnName?: string): string {
  if (err instanceof ZodError) {
    return capErrorText(
      err.issues
        .map((issue) => {
          const segments =
            fnName === undefined ? issue.path : [fnName, ...issue.path];
          const path = segments.map(String).join(".");
          return path === "" ? issue.message : `${path}: ${issue.message}`;
        })
        .join("\n"),
    );
  }
  return capErrorText(err instanceof Error ? err.message : String(err));
}
