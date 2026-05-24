/**
 * `modelica.openRepl` and `modelica.repl.exec`.
 *
 * - `openRepl` materialises a VSCode terminal backed by `ModelicaReplPty`.
 *   The terminal name is "Modelica REPL". We don't `dispose()` it on close —
 *   VSCode handles that when the user closes the tab; our pty's
 *   `closeEmitter` fires for `:exit`, which triggers VSCode to dispose.
 *
 * - `repl.exec` is a programmatic surface: callers pass a single command
 *   string and get back the OMC reply text (or a thrown Error). It runs
 *   the same `evalLine` pipeline so meta-commands work there too.
 *
 * Both commands lazily build their deps from `ctx.ensureClient` /
 * `ctx.resetClient` (falling back to a recreate-via-ensure if no reset
 * helper was wired — keeps the module robust if `CommandContext` changes).
 *
 * `showInRepl(label, output, isError?)` is the side-channel other commands
 * (e.g. Check Model) use to mirror their output into the REPL so the user
 * sees a unified transcript. It opens the REPL on first call.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { evalLine, type ReplDependencies } from "../repl/repl-eval.js";
import { ModelicaReplPty } from "../repl/repl-pty.js";

import type { CommandContext } from "./context.js";

interface ActiveRepl {
  pty: ModelicaReplPty;
  terminal: vscode.Terminal;
}

/**
 * Module-level singleton. The REPL terminal is a piece of UI state that's
 * naturally global from the user's perspective ("the Modelica REPL"), and
 * the only writer is `registerReplCommands` at activation time + the
 * close listener.
 */
let activeRepl: ActiveRepl | undefined;

/** Cached deps so `showInRepl()` can open the REPL on demand. */
let cachedDeps: ReplDependencies | undefined;

export function registerReplCommands(ctx: CommandContext): vscode.Disposable[] {
  const deps = buildDeps(ctx);
  cachedDeps = deps;

  const onClose = vscode.window.onDidCloseTerminal((t) => {
    if (activeRepl && t === activeRepl.terminal) {
      activeRepl = undefined;
    }
  });

  return [
    onClose,
    vscode.commands.registerCommand("modelica.openRepl", () => {
      openOrFocusRepl(deps);
    }),

    vscode.commands.registerCommand(
      "modelica.repl.exec",
      async (cmd: string): Promise<string> => {
        if (typeof cmd !== "string") {
          throw new Error("modelica.repl.exec: argument must be a string");
        }
        const result = await evalLine(cmd, deps);
        if (result.isError) {
          throw new Error(result.output);
        }
        return result.output;
      },
    ),
  ];
}

function openOrFocusRepl(deps: ReplDependencies): ActiveRepl {
  if (activeRepl) {
    // `show(preserveFocus=true)` reveals without stealing keyboard focus —
    // important for the tee path so an editor save doesn't yank the cursor.
    activeRepl.terminal.show(true);
    return activeRepl;
  }
  const pty = new ModelicaReplPty(deps);
  const terminal = vscode.window.createTerminal({
    name: "Modelica REPL",
    pty,
  });
  terminal.show(true);
  activeRepl = { pty, terminal };
  return activeRepl;
}

/**
 * Mirror an external command's output into the REPL transcript. Opens
 * the REPL if it's not already visible. Safe to call before the REPL has
 * processed `open()` — the pty buffers writes until then.
 *
 * Returns `false` if the REPL machinery hasn't been registered yet (would
 * only happen if a caller fires before `activate()` finishes); the caller
 * decides whether to fall back to logger-only.
 */
export function showInRepl(
  label: string,
  output: string,
  isError = false,
): boolean {
  if (!cachedDeps) return false;
  const r = openOrFocusRepl(cachedDeps);
  r.pty.showExternal(label, output, isError);
  return true;
}

/**
 * Per-command logger that mirrors a command's result into the REPL,
 * matching the transcript shape Check Model produces. Returned from
 * `createReplLog(label)` so the command picks the label once and then
 * calls `.success(body)` or `.error(body)` when the work completes.
 *
 * Usage idiom:
 *
 * ```
 * const log = createReplLog(`loadLibrary(${name})`);
 * try {
 *   const { success } = await c.loadModel({ typeName: name });
 *   if (!success) {
 *     const { errorString } = await c.getErrorString();
 *     log.error(errorString || "loadModel failed");
 *     return;
 *   }
 *   log.success(`loaded ${name}`);
 * } catch (err) {
 *   log.error((err as Error).message);
 * }
 * ```
 *
 * Both methods are no-ops when the REPL hasn't been registered yet
 * (extension still activating); the boolean return mirrors `showInRepl`
 * for callers that care.
 */
export interface ReplLog {
  /** Mirror a successful result line into the REPL (no error colouring). */
  success(output: string): boolean;
  /** Mirror an error result line into the REPL (red). */
  error(output: string): boolean;
}

export function createReplLog(label: string): ReplLog {
  return {
    success: (output) => showInRepl(label, output, false),
    error: (output) => showInRepl(label, output, true),
  };
}

/** Programmatic dependency factory — also re-used by the extension's exported API. */
export function buildDeps(ctx: CommandContext): ReplDependencies {
  return {
    ensureClient: () => ctx.ensureClient(),
    resetClient: async (): Promise<OmcClient> => {
      if (ctx.resetClient) return ctx.resetClient();
      // Fallback: we don't own the cached handle from out here, so the
      // best we can do is grab a (possibly stale) client and ask it to
      // close; the next ensureClient() spawns a fresh one. This only
      // fires if `CommandContext.resetClient` was forgotten — kept as a
      // safety net.
      const c = await ctx.ensureClient();
      await c.close();
      return ctx.ensureClient();
    },
  };
}
