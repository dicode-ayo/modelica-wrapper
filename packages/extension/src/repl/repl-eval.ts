/**
 * Pure evaluator for one REPL input line.
 *
 * Kept free of `vscode` imports so it can run in plain Node for unit tests.
 * The terminal (`repl-pty.ts`) wraps the result in ANSI coloring and prints
 * it; this module only decides what the output text should be.
 *
 * Meta-commands (lines starting with `:`) dispatch through `META_HANDLERS`,
 * one per verb in `repl-help.ts`'s `META_COMMANDS`. Everything else is
 * forwarded to `client.call()`. After a forwarded call we drain
 * `client.getErrorString()` and surface any non-empty error buffer in
 * addition to the OMC reply — OMC can return a value AND a diagnostic in
 * the same step (e.g. typing a malformed expression). We separately mark
 * the result as `isError: true` so the terminal can pick a color.
 *
 * Project rule: every OMC call constructed by this module must go through
 * a typed wrapper on `OmcClient`. The bare `client.call(rawLine)` below is
 * the one legitimate exception — it forwards free-form user input that we
 * cannot pre-wrap. Meta-commands (`:load`, `:cd`, `:reset`, …) are our own
 * code and use the typed surface (`client.loadFile`, `client.cd`, etc).
 */

import type { OmcClient } from "@dicode/omc-client";
import type { OmcCommand } from "@dicode/omc-client";

import { diagnoseOmcError } from "./repl-diagnose.js";
import { formatHelp, type MetaCommandName } from "./repl-help.js";

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

/**
 * Static help text — kept for tests that compare against the no-arg help.
 * The full dynamic renderer lives in `repl-help.ts`.
 */
export const HELP_TEXT = formatHelp(undefined).output;

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
      // Try to translate OMC's misleading "Class X not found" into an
      // actionable hint before showing the raw error. The hint goes on
      // top so it's the first thing the user reads; OMC's original
      // message follows verbatim for power users / debugging.
      const hint = diagnoseOmcError(rawLine, errorString);
      const errorBody = hint
        ? `${hint}\n\nOMC said:\n  ${errorString}`
        : `error: ${errorString}`;
      const combined =
        trimmedReply.length > 0 ? `${trimmedReply}\n${errorBody}` : errorBody;
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

type MetaHandler = (
  arg: string,
  deps: ReplDependencies,
) => Promise<ReplResult> | ReplResult;

/**
 * One handler per `MetaCommandName`. `Record` forces this object literal to
 * cover every verb in `META_COMMANDS` (and no others) — adding, removing, or
 * renaming a verb there without updating this map is a compile error rather
 * than a silent runtime "unknown meta-command".
 */
const META_HANDLERS: Record<MetaCommandName, MetaHandler> = {
  ":help": (arg) => {
    const { output, unknown } = formatHelp(arg);
    return { output, isError: unknown };
  },
  ":clear": () => ({ output: "", isError: false, clearScreen: true }),
  ":exit": () => ({ output: "bye", isError: false, closeTerminal: true }),
  ":load": metaLoad,
  ":cd": metaCd,
  ":reset": (_arg, deps) => metaReset(deps),
};

function isMetaCommandName(cmd: string): cmd is MetaCommandName {
  return Object.prototype.hasOwnProperty.call(META_HANDLERS, cmd);
}

async function handleMeta(
  line: string,
  deps: ReplDependencies,
): Promise<ReplResult> {
  // Split into command + remainder so `:load /path with spaces` keeps the
  // remainder intact. Modelica path arguments commonly contain spaces.
  // Splits on any whitespace, matching repl-complete.ts's selectSource so
  // the two agree on where the verb ends.
  const spaceIdx = line.search(/\s/);
  const cmd = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

  if (!isMetaCommandName(cmd)) {
    return {
      output: `error: unknown meta-command "${cmd}" (try :help)`,
      isError: true,
    };
  }
  return META_HANDLERS[cmd](arg, deps);
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
  try {
    const client = await deps.ensureClient();
    // OMC's `cd` doubles as a getter: empty `newWorkingDirectory`
    // returns the current cwd without changing it. So `:cd` with no
    // argument prints the cwd (handy after the extension auto-cd's into
    // `<workspace>/.modelica`), and `:cd <path>` changes it.
    //
    // OMC returns an empty string on failure on some versions; on
    // 1.26.x a bad path is a silent no-op that returns the prior cwd.
    // We treat empty-string output as the only "failed" signal here.
    const { workingDirectory } = await client.cd({
      newWorkingDirectory: arg,
    });
    if (workingDirectory.length === 0) {
      const { errorString } = await client.getErrorString();
      return {
        output: `error: cd failed${errorString ? `: ${errorString}` : ""}`,
        isError: true,
      };
    }
    return { output: workingDirectory, isError: false };
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

/**
 * Heuristic — treat the error buffer as a hard error if it mentions the
 * literal word "Error" (OMC's diagnostic-level marker). Warnings/notices
 * are still surfaced via `output` but don't paint the whole line red.
 */
function looksLikeError(errorString: string): boolean {
  return /\bError\b/.test(errorString);
}
