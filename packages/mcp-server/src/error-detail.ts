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

/** Keeps `text`'s head and elides the remainder, noting how much was cut. */
function capErrorText(text: string): string {
  const lines = text.split("\n");
  if (lines.length > MAX_ERROR_LINES) {
    const head = lines.slice(0, MAX_ERROR_LINES).join("\n");
    const elided = lines.length - MAX_ERROR_LINES;
    return `${head}\n...\n[+${elided} more lines elided]`;
  }
  if (text.length > MAX_ERROR_CHARS) {
    const head = text.slice(0, MAX_ERROR_CHARS);
    const elided = text.length - MAX_ERROR_CHARS;
    return `${head}\n...\n[+${elided} more characters elided]`;
  }
  return text;
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
 * The result is always capped (`capErrorText`) — this is the one place every
 * tool error passes through before reaching the MCP client, so it is where a
 * refusal that came back as hundreds of KB of OMC prose gets cut down to size.
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
