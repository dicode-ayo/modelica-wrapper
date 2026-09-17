import { ZodError } from "zod";

/**
 * The message of a caught `unknown`, without assuming it's an `Error`.
 *
 * A `ZodError` — thrown by `OmcClient.invoke`'s own input validation, which
 * `omc_invoke` is the one caller with no schema of its own to catch this
 * first — renders as one line per issue: the argument path and the schema's
 * own message, dropping `code`/`format`/`pattern` and the rest of zod's
 * bookkeeping. `fnName`, when given, prefixes each path so the line names
 * the call the argument belonged to.
 */
export function errorDetail(err: unknown, fnName?: string): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((issue) => {
        const segments =
          fnName === undefined ? issue.path : [fnName, ...issue.path];
        const path = segments.map(String).join(".");
        return path === "" ? issue.message : `${path}: ${issue.message}`;
      })
      .join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}
