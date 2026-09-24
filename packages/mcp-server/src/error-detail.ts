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
 * `MAX_ERROR_LINES` can still be huge if those few lines are each long. The
 * char cap applies to the lines the line cap kept, so a message that trips
 * both gets one combined elision count.
 */
export function capErrorText(text: string): string {
  const lines = text.split("\n");
  const keptLines =
    lines.length > MAX_ERROR_LINES ? lines.slice(0, MAX_ERROR_LINES) : lines;
  const elidedLines = lines.length - keptLines.length;

  let head = keptLines.join("\n");
  let elidedChars = 0;
  if (head.length > MAX_ERROR_CHARS) {
    elidedChars = head.length - MAX_ERROR_CHARS;
    head = head.slice(0, MAX_ERROR_CHARS);
  }

  if (elidedLines === 0 && elidedChars === 0) return text;

  const notes = [
    elidedLines > 0 ? `${elidedLines} more lines` : undefined,
    elidedChars > 0 ? `${elidedChars} more characters` : undefined,
  ].filter((note) => note !== undefined);
  return `${head}\n...\n[+${notes.join(", ")} elided]`;
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
 * The result is always capped (`capErrorText`). A raw OMC reason that is
 * already a known `string` (not an `unknown` catch value) should call
 * `capErrorText` directly rather than round-tripping through here.
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
