/**
 * `modelica.checkModel` — user-triggered structural + semantic check.
 *
 * Resolution order for the target class:
 *   1. The active diagram panel, if any (`DiagramPanel.activeClassName()`).
 *   2. The active text editor when its document uses the `modelica-source:`
 *      scheme (mapped back to a qualified name via `qualifiedNameFromUri`).
 *   3. None — show a warning and bail.
 *
 * Behavior (decided in the planning discussion, see PR description):
 *   - Drains OMC's error buffer before kicking off the check.
 *   - Streams progress to a Notification toast that the user can cancel.
 *   - Logs each phase (>>>, result, summary) to the shared "Modelica" output
 *     channel — no second channel.
 *   - On completion, clears ALL prior diagnostics in the shared collection and
 *     replaces them with the fresh set. Live-check (Phase 2) writes per-file
 *     and does NOT clobber other files.
 *   - Auto-focuses the Problems panel only when errors > 0.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import { mapOmcMessagesToDiagnostics } from "../diagnostics/from-omc.js";
import { DiagramPanel } from "../diagram/panel.js";
import { log } from "../logger.js";
import {
  MODELICA_SOURCE_SCHEME,
  qualifiedNameFromUri,
  sourceUriFor,
} from "../source-provider.js";

import { liveCheckLock } from "./check-lock.js";
import type { CommandContext } from "./context.js";
import { createReplLog } from "./repl.js";

export function registerCheckModelCommand(
  ctx: CommandContext,
): vscode.Disposable {
  return vscode.commands.registerCommand("modelica.checkModel", async () => {
    const className = resolveTargetClass();
    if (!className) {
      await vscode.window.showWarningMessage(
        "Modelica: no active class to check (focus a diagram or a Modelica source view first).",
      );
      return;
    }
    try {
      const client = await ctx.ensureClient();
      // Serialize against any in-flight live-check so we don't fight over
      // the OMC error buffer or the shared diagnostic collection.
      await liveCheckLock.acquire(() =>
        runCheckModel(client, ctx.diagnostics, className),
      );
    } catch (err) {
      log.error("checkModel", `failed for ${className}`, err);
      await vscode.window.showErrorMessage(
        `Modelica: Check Model failed for ${className}: ${(err as Error).message}`,
      );
    }
  });
}

function resolveTargetClass(): string | undefined {
  const fromDiagram = DiagramPanel.activeClassName();
  if (fromDiagram) return fromDiagram;
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === MODELICA_SOURCE_SCHEME) {
    return qualifiedNameFromUri(editor.document.uri);
  }
  return undefined;
}

async function runCheckModel(
  client: OmcClient,
  diagnostics: vscode.DiagnosticCollection,
  className: string,
): Promise<void> {
  // Reveal the Modelica output channel so the user actually sees this run.
  // `log.show()` passes preserveFocus=true so keyboard focus stays where it
  // is (typing in the editor must not be interrupted).
  log.show();
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Checking ${className}`,
    },
    async (_progress, token) => {
      // Best-effort: look up the class's on-disk source path so we can map
      // OMC diagnostics referring to that path back to the user's virtual
      // editor (`modelica-source:/<Class>.mo`). Errors here are non-fatal —
      // the class may have failed to load and the resolver still handles the
      // URI-prefix case below.
      const info = await client
        .getClassInformation({ typeName: className })
        .catch(() => undefined);
      const virtualUri = sourceUriFor(className);
      const virtualUriString = virtualUri.toString();
      const onDiskPath = info?.fileName ?? "";
      const resolver = (name: string): vscode.Uri | undefined => {
        // The class's on-disk source — map to virtual URI so squiggles land
        // in the user's open `modelica-source:` editor.
        if (onDiskPath && name === onDiskPath) return virtualUri;
        if (name === virtualUriString) return virtualUri;
        // Belt-and-suspenders: any modelica-source: URI string OMC echoes
        // back (e.g. from a live-check buffer) parses to its URI.
        if (name.startsWith(`${MODELICA_SOURCE_SCHEME}:`)) {
          try {
            return vscode.Uri.parse(name);
          } catch {
            return undefined;
          }
        }
        return undefined;
      };

      // Drain OMC's pre-existing diagnostic buffer so what we read after
      // checkModel reflects this run only.
      await client.getErrorString();
      if (token.isCancellationRequested) return;

      const stamp = new Date().toISOString().slice(11, 23);
      log.info("checkModel", `${stamp} >>> checkModel(${className})`);

      const { result } = await client.checkModel({ typeName: className });
      if (token.isCancellationRequested) return;
      log.info("checkModel", result);

      const { messages } = await client.getMessagesStringInternal();
      if (token.isCancellationRequested) return;

      // Clear-all + replace: this is the user-triggered "global refresh" path.
      diagnostics.clear();
      const grouped = mapOmcMessagesToDiagnostics(messages, resolver);
      for (const [uri, diags] of grouped) {
        diagnostics.set(uri, diags);
      }

      let errors = 0;
      let warnings = 0;
      for (const m of messages) {
        if (m.level === "error" || m.level === "internal") errors++;
        else if (m.level === "warning") warnings++;
      }
      const summary =
        errors === 0 && warnings === 0
          ? "Check passed"
          : `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
      log.info("checkModel", `<<< ${summary}`);

      // Mirror the run into the REPL transcript so the result is visible
      // alongside the user's other interactive commands. `result` is
      // OMC's own pretty output; we append our 1-line summary for
      // at-a-glance status. Errors paint red in the REPL.
      const replLog = createReplLog(`checkModel ${className}`);
      const replOutput =
        (result.length > 0 ? result + "\n" : "") + summary;
      if (errors > 0) replLog.error(replOutput);
      else replLog.success(replOutput);

      if (errors > 0) {
        await vscode.commands.executeCommand("workbench.action.problems.focus");
      }
    },
  );
}
