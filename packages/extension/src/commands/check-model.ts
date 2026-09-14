/**
 * `modelica.checkModel` — user-triggered structural + semantic check.
 *
 * Resolution order for the target class:
 *   0. An explicit `className` command argument, when passed (the diagram
 *      custom editor names its class directly).
 *   1. The active diagram editor, if any (`DiagramEditorProvider.activeClassName()`).
 *   2. The active text editor when its document uses the `modelica-source:`
 *      scheme (mapped back to a qualified name via `qualifiedNameFromUri`).
 *   3. None — show a warning and bail.
 *
 * Behavior (decided in the planning discussion, see PR description):
 *   - Drains OMC's error buffer before kicking off the check.
 *   - For a class stored inline in a shared file, reloads that file so OMC's
 *     positions and the virtual editor's agree; this leaves OMC holding the
 *     file's own coordinates.
 *   - Streams progress to a Notification toast that the user can cancel.
 *   - Logs each phase (>>>, result, summary) to the shared "Modelica" output
 *     channel — no second channel.
 *   - On completion, clears ALL prior diagnostics in the shared collection and
 *     replaces them with the fresh set. Live-check (Phase 2) writes per-file
 *     and does NOT clobber other files.
 *   - Auto-focuses the Problems panel only when errors > 0.
 */

import * as vscode from "vscode";

import type { ErrorMessage } from "@dicode/omc-client";

import {
  buildSourceUriResolver,
  mapOmcMessagesToDiagnostics,
} from "../diagnostics/from-omc.js";
import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import { sourceFilenames } from "../file-owner.js";
import { log } from "../logger.js";
import {
  alignOwnSourceToSharedFile,
  keepForBuffer,
  type SharedFileClient,
} from "../shared-file-diagnostics.js";
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
  return vscode.commands.registerCommand(
    "modelica.checkModel",
    async (arg?: unknown) => {
      // A caller can name the class directly (the diagram custom editor, which
      // isn't a text editor and so wouldn't be found by the fallback); the
      // arg-less panel / source-view callers keep the active-target resolution.
      const className =
        typeof arg === "string" && arg.length > 0 ? arg : resolveTargetClass();
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
    },
  );
}

function resolveTargetClass(): string | undefined {
  const fromDiagram = DiagramEditorProvider.activeClassName();
  if (fromDiagram) return fromDiagram;
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === MODELICA_SOURCE_SCHEME) {
    return qualifiedNameFromUri(editor.document.uri);
  }
  return undefined;
}

/** The OMC surface `runCheckModel` drives. `OmcClient` satisfies it. */
export interface CheckModelClient extends SharedFileClient {
  getErrorString(): Promise<{ errorString: string }>;
  checkModel(input: { typeName: string }): Promise<{ result: string }>;
  getMessagesStringInternal(): Promise<{ messages: ErrorMessage[] }>;
}

export async function runCheckModel(
  client: CheckModelClient,
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
      // Best-effort: the name OMC reports this class's source under, mapped
      // back to the user's virtual editor. A failure here is non-fatal — the
      // class may have failed to load and the resolver still handles the
      // URI-prefix case.
      const { reported: omcFilename, onDisk: onDiskPath } =
        await sourceFilenames(client, className);
      const virtualUri = sourceUriFor(className);
      const resolver = buildSourceUriResolver({ omcFilename, virtualUri });

      // Drain OMC's pre-existing diagnostic buffer so what we read after
      // checkModel reflects this run only.
      await client.getErrorString();
      if (token.isCancellationRequested) return;

      // A class stored inline in a shared file (e.g. `package.mo`) is reported
      // by OMC at its real file-relative line, while the virtual editor shows
      // only that class's own pretty-printed text numbered from line 1.
      const coords = onDiskPath
        ? await alignOwnSourceToSharedFile(client, {
            typeName: className,
            filename: onDiskPath,
          })
        : undefined;
      if (token.isCancellationRequested) return;

      // The alignment reload above can itself leave messages in OMC's buffer
      // (e.g. a sibling's pre-existing issue, surfaced only because realigning
      // reloads the whole file); drain them so the run below reflects
      // checkModel's own result, not the reload's side effects.
      if (coords) await client.getErrorString();
      if (token.isCancellationRequested) return;

      const stamp = new Date().toISOString().slice(11, 23);
      log.info("checkModel", `${stamp} >>> checkModel(${className})`);

      const { result } = await client.checkModel({ typeName: className });
      if (token.isCancellationRequested) return;
      log.info("checkModel", result);

      const { messages } = await client.getMessagesStringInternal();
      if (token.isCancellationRequested) return;

      // Clear-all + replace: this is the user-triggered "global refresh" path.
      // Bound/shift onto the buffer's own coordinates for squiggle placement;
      // the error/warning counts below still reflect the true check outcome.
      const bounded =
        onDiskPath && coords
          ? keepForBuffer(messages, onDiskPath, coords)
          : messages;
      diagnostics.clear();
      const grouped = mapOmcMessagesToDiagnostics(bounded, resolver);
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
      const replOutput = (result.length > 0 ? result + "\n" : "") + summary;
      if (errors > 0) replLog.error(replOutput);
      else replLog.success(replOutput);

      if (errors > 0) {
        await vscode.commands.executeCommand("workbench.action.problems.focus");
      }
    },
  );
}
