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
 */

import * as vscode from "vscode";

import type { OmcClient } from "@modelica-wrapper/omc-client";

import { evalLine, type ReplDependencies } from "../repl/repl-eval.js";
import { ModelicaReplPty } from "../repl/repl-pty.js";

import type { CommandContext } from "./context.js";

export function registerReplCommands(ctx: CommandContext): vscode.Disposable[] {
  const deps = buildDeps(ctx);

  return [
    vscode.commands.registerCommand("modelica.openRepl", () => {
      const pty = new ModelicaReplPty(deps);
      const terminal = vscode.window.createTerminal({
        name: "Modelica REPL",
        pty,
      });
      terminal.show();
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
