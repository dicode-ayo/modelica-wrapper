/**
 * Pure evaluator for one REPL input line.
 *
 * Kept free of `vscode` imports so it can run in plain Node for unit tests.
 * The terminal (`repl-pty.ts`) wraps the result in ANSI coloring and prints
 * it; this module only decides what the output text should be.
 *
 * Meta-commands (lines starting with `:`) are handled inline. Everything
 * else is forwarded to `client.call()`. After a forwarded call we drain
 * `client.getErrorString()` and surface any non-empty error buffer in
 * addition to the OMC reply — OMC can return a value AND a diagnostic in
 * the same step (e.g. typing a malformed expression). We separately mark
 * the result as `isError: true` so the terminal can pick a color.
 *
 * Note: `:cd <path>` uses a raw `call('cd("...")')` because `OmcClient`
 * does not expose a dedicated `cd` wrapper today; if/when one lands, this
 * call can switch over without a behavioural change.
 */

import type { OmcClient } from "@modelica-wrapper/omc-client";
import type { OmcCommand } from "@modelica-wrapper/omc-client";

export interface ReplDependencies {
  /** Lazy/cached singleton OMC client. */
  ensureClient: () => Promise<OmcClient>;
  /** Close-then-recreate the singleton — used by `:reset`. */
  resetClient: () => Promise<OmcClient>;
}

export interface ReplResult {
  /** Text to print (may contain `\n`; the pty normalises to `\r\n`). */
  output: string;
  /** When true, the pty colours `output` red. */
  isError: boolean;
  /** When true, the pty closes the terminal after writing `output`. */
  closeTerminal?: boolean;
  /** When true, the pty wipes the screen before writing the next prompt. */
  clearScreen?: boolean;
}

export const HELP_TEXT = [
  "Modelica REPL meta-commands:",
  "  :help            Show this help",
  "  :clear           Clear the terminal screen (does not touch OMC state)",
  "  :load <path>     Call loadFile on <path>",
  "  :cd <path>       Change OMC's working directory",
  "  :reset           Close the OMC subprocess and start a fresh one",
  "  :exit            Close this REPL terminal",
  "Anything else is forwarded verbatim to OMC via call().",
].join("\n");

/**
 * Dispatch a single line. Returns the formatted result (no trailing newline;
 * the pty appends one).
 */
export async function evalLine(
  rawLine: string,
  deps: ReplDependencies,
): Promise<ReplResult> {
  const line = rawLine.trim();
  if (line.length === 0) {
    return { output: "", isError: false };
  }

  if (line.startsWith(":")) {
    return handleMeta(line, deps);
  }

  // Plain OMC command. We send the user's text verbatim — OMC owns the
  // parsing, so we don't try to be clever about trailing semicolons.
  try {
    const client = await deps.ensureClient();
    // OmcClient.call's signature is a template-literal type for the few
    // call sites that pass a literal; the REPL by definition takes free
    // text, so we cast to the underlying contract. OMC will surface any
    // parse error in its reply / error buffer.
    const reply = await client.call(rawLine as OmcCommand);
    // OMC often populates the error buffer in addition to returning a
    // value. Drain it AFTER reading the reply so this run's diagnostics
    // come out together.
    let errorString = "";
    try {
      const r = await client.getErrorString();
      errorString = r.errorString ?? "";
    } catch {
      // getErrorString itself failing isn't fatal — fall back to the
      // primary reply only.
    }
    const trimmedReply = stripTrailingNewline(reply);
    if (errorString.length > 0) {
      const isError = looksLikeError(errorString);
      const combined =
        trimmedReply.length > 0
          ? `${trimmedReply}\nerror: ${errorString}`
          : `error: ${errorString}`;
      return { output: combined, isError };
    }
    return { output: trimmedReply, isError: false };
  } catch (err) {
    return {
      output: `error: ${(err as Error).message}`,
      isError: true,
    };
  }
}

async function handleMeta(
  line: string,
  deps: ReplDependencies,
): Promise<ReplResult> {
  // Split into command + remainder so `:load /path with spaces` keeps the
  // remainder intact. Modelica path arguments commonly contain spaces.
  const spaceIdx = line.indexOf(" ");
  const cmd = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case ":help":
      return { output: HELP_TEXT, isError: false };

    case ":clear":
      return { output: "", isError: false, clearScreen: true };

    case ":exit":
      return { output: "bye", isError: false, closeTerminal: true };

    case ":load":
      return metaLoad(arg, deps);

    case ":cd":
      return metaCd(arg, deps);

    case ":reset":
      return metaReset(deps);

    default:
      return {
        output: `error: unknown meta-command "${cmd}" (try :help)`,
        isError: true,
      };
  }
}

async function metaLoad(
  arg: string,
  deps: ReplDependencies,
): Promise<ReplResult> {
  if (arg.length === 0) {
    return { output: "error: :load requires a path", isError: true };
  }
  try {
    const client = await deps.ensureClient();
    const { success } = await client.loadFile({ fileName: arg });
    if (!success) {
      const { errorString } = await client.getErrorString();
      return {
        output: `error: loadFile failed${errorString ? `: ${errorString}` : ""}`,
        isError: true,
      };
    }
    return { output: "loaded", isError: false };
  } catch (err) {
    return {
      output: `error: ${(err as Error).message}`,
      isError: true,
    };
  }
}

async function metaCd(
  arg: string,
  deps: ReplDependencies,
): Promise<ReplResult> {
  if (arg.length === 0) {
    return { output: "error: :cd requires a path", isError: true };
  }
  try {
    const client = await deps.ensureClient();
    // OMC's `cd("<path>")` returns the new working directory (or empty
    // string on failure). No dedicated wrapper exists on OmcClient, so
    // we route through `call()` directly. Quote characters in the path
    // are escaped defensively.
    const escaped = arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    // `cd` isn't in the registered OmcFunction enum (it's an interactive
    // scripting builtin), so the template literal doesn't match the
    // typed `OmcCommand` union — cast through.
    const reply = stripTrailingNewline(
      await client.call(`cd("${escaped}")` as OmcCommand),
    );
    const newCwd = stripSurroundingQuotes(reply);
    if (newCwd.length === 0) {
      const { errorString } = await client.getErrorString();
      return {
        output: `error: cd failed${errorString ? `: ${errorString}` : ""}`,
        isError: true,
      };
    }
    return { output: newCwd, isError: false };
  } catch (err) {
    return {
      output: `error: ${(err as Error).message}`,
      isError: true,
    };
  }
}

async function metaReset(deps: ReplDependencies): Promise<ReplResult> {
  try {
    await deps.resetClient();
    return { output: "OMC reset (fresh state)", isError: false };
  } catch (err) {
    return {
      output: `error: reset failed: ${(err as Error).message}`,
      isError: true,
    };
  }
}

function stripTrailingNewline(s: string): string {
  return s.replace(/\r?\n+$/, "");
}

function stripSurroundingQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Heuristic — treat the error buffer as a hard error if it mentions the
 * literal word "Error" (OMC's diagnostic-level marker). Warnings/notices
 * are still surfaced via `output` but don't paint the whole line red.
 */
function looksLikeError(errorString: string): boolean {
  return /\bError\b/.test(errorString);
}
