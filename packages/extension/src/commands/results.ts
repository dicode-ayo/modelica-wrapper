/**
 * Postprocessing result-view commands:
 * - `modelica.createResultView()` — create an empty `*.omresults` and open it
 *   in the result-view editor (the only way to bring a view into existence).
 * - `modelica.addResultToView(args)` — programmatic; the diagram's Simulate
 *   handler fires it with the just-produced `.mat`. It adds to the focused
 *   result view when there is one; otherwise it surfaces the result in an
 *   unsaved ("scratch") view so a run is never silently dropped.
 */

import * as path from "node:path";

import * as vscode from "vscode";

import { emptyResultViewDoc, type ResultRef } from "@dicode/omc-client";

import { buildResultRef, mutateAddResults } from "../results/add-result.js";
import { serializeResultViewDoc } from "../results/result-doc.js";
import { ResultViewDocument } from "../results/result-view-document.js";
import {
  RESULT_VIEW_VIEW_TYPE,
  ResultViewEditorProvider,
} from "../results/result-view-provider.js";
import { workspaceCacheUri } from "../workspace-cache.js";
import type { CommandContext } from "./context.js";

/** Command id the diagram's Simulate handler fires to auto-add its result. */
export const ADD_RESULT_TO_VIEW_COMMAND = "modelica.addResultToView";

/** Payload for {@link ADD_RESULT_TO_VIEW_COMMAND}. */
export interface AddResultToViewArgs {
  /** Class that produced the result, kept as provenance on the `ResultRef`. */
  model: string;
  /** `.mat` path from OMC — absolute, or relative to the `.modelica` cwd. */
  resultFile: string;
  /** Run parameter overrides, when known. */
  parameters?: Record<string, string>;
}

export function registerResultCommands(
  _ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createResultView",
      createResultView,
    ),
    vscode.commands.registerCommand(
      ADD_RESULT_TO_VIEW_COMMAND,
      addResultToView,
    ),
  ];
}

async function createResultView(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const target = await vscode.window.showSaveDialog({
    saveLabel: "Create Result View",
    filters: { "Result view": ["omresults"] },
    ...(folder
      ? { defaultUri: vscode.Uri.joinPath(folder.uri, "results.omresults") }
      : {}),
  });
  if (!target) {
    return;
  }
  const bytes = new TextEncoder().encode(
    serializeResultViewDoc(emptyResultViewDoc()),
  );
  await vscode.workspace.fs.writeFile(target, bytes);
  await vscode.commands.executeCommand(
    "vscode.openWith",
    target,
    RESULT_VIEW_VIEW_TYPE,
  );
}

export async function addResultToView(
  args: AddResultToViewArgs,
): Promise<void> {
  if (typeof args?.resultFile !== "string" || args.resultFile === "") {
    return;
  }
  const active = ResultViewEditorProvider.getActiveResultDoc();
  if (active) {
    const ref = simulateRef(active.uri, args);
    const result = await mutateAddResults(active, [ref]);
    if (result.persisted && result.added > 0) {
      void vscode.window.showInformationMessage(
        `Added ${ref.label} to the result view.`,
      );
    }
    return;
  }
  await surfaceInScratchView(args);
}

/**
 * Surface the run's result in a fresh unsaved ("scratch") result view. A
 * pathless untitled document keeps `Ctrl+S` a Save-As (a named untitled would
 * save straight to a bogus root path), and `openWith` forces our editor despite
 * the missing `.omresults` suffix. Once open the view becomes the active target,
 * so follow-up runs append through the focused-view path above rather than here.
 * Revealing the view is the feedback; unlike that path there is no toast.
 *
 * Wraps the document in its own throwaway `ResultViewDocument` (no webview to
 * report a write failure to yet) so the seed write goes through the same
 * `mutateAddResults` path as every other add, rather than a second one of its own.
 */
async function surfaceInScratchView(args: AddResultToViewArgs): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    content: "",
    language: "omresults",
  });
  const resultDoc = new ResultViewDocument(document, () => {});
  await mutateAddResults(resultDoc, [simulateRef(document.uri, args)]);
  await vscode.commands.executeCommand(
    "vscode.openWith",
    document.uri,
    RESULT_VIEW_VIEW_TYPE,
  );
}

/** Build the `simulate`-sourced `ResultRef` for a run's `.mat`. */
function simulateRef(
  documentUri: vscode.Uri,
  args: AddResultToViewArgs,
): ResultRef {
  return buildResultRef(
    documentUri,
    resolveSimResult(args.resultFile),
    "simulate",
    {
      model: args.model,
      ...(args.parameters ? { parameters: args.parameters } : {}),
    },
  );
}

/** Resolve OMC's `resultFile` to an absolute path: relative paths hang off the
 * `.modelica` cache directory, which is OMC's working directory. */
function resolveSimResult(resultFile: string): string {
  if (path.isAbsolute(resultFile)) {
    return resultFile;
  }
  const cache = workspaceCacheUri();
  return cache ? path.join(cache.fsPath, resultFile) : resultFile;
}
