import * as vscode from "vscode";

import {
  DIAGRAM_VIEW_TYPE,
  DOCUMENTATION_VIEW_TYPE,
  ICON_VIEW_TYPE,
} from "./diagram/view-type.js";
import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";
import { MODELICA_SOURCE_SCHEME } from "./source-provider.js";

const CUSTOM_EDITOR_VIEW_TYPES: ReadonlySet<string> = new Set([
  DIAGRAM_VIEW_TYPE,
  ICON_VIEW_TYPE,
  DOCUMENTATION_VIEW_TYPE,
]);

/**
 * Re-open Modelica custom editors that VSCode restored before the
 * `modelica-source` filesystem provider went live, which otherwise strands them
 * on VSCode's "Unable to resolve resource" page: provider registration is
 * proxied to the workbench asynchronously, so an editor restored mid-activation
 * can resolve against a scheme the file service doesn't know yet, and VSCode
 * never retries a failed custom-editor restore. Firing this right after the
 * provider is registered relies on the reopen's `close`/`openWith` round-trips
 * reaching the workbench after that registration message on the same channel.
 *
 * Runs only at activation — the one moment every open Modelica custom editor is
 * necessarily a restored tab — so a working session is never disrupted, and
 * skips dirty tabs so closing one can't discard an unsaved edit. Closing then
 * re-opening forces a fresh document resolution against the now-registered
 * scheme; a tab that restored cleanly merely reloads.
 */
export async function recoverRestoredCustomEditors(): Promise<void> {
  const targets: {
    tab: vscode.Tab;
    uri: vscode.Uri;
    viewType: string;
    column: vscode.ViewColumn;
  }[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.uri.scheme === MODELICA_SOURCE_SCHEME &&
        CUSTOM_EDITOR_VIEW_TYPES.has(input.viewType) &&
        !tab.isDirty
      ) {
        targets.push({
          tab,
          uri: input.uri,
          viewType: input.viewType,
          column: group.viewColumn,
        });
      }
    }
  }
  if (targets.length === 0) return;
  try {
    await vscode.window.tabGroups.close(targets.map((t) => t.tab));
    for (const { uri, viewType, column } of targets) {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        viewType,
        column,
      );
    }
  } catch (err) {
    log.warn(
      "activate",
      `re-opening restored custom editors failed: ${errorDetail(err)}`,
    );
  }
}
