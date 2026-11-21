import * as vscode from "vscode";

export type WorkspaceFolderChoice =
  | { kind: "none" }
  | { kind: "cancelled" }
  | { kind: "picked"; folder: vscode.WorkspaceFolder };

/**
 * The folder a scaffolding command writes into. A single-root window answers
 * without a prompt; a multi-root one asks, since defaulting to folder 0 would
 * write somewhere the user never chose.
 */
export async function pickWorkspaceFolder(
  placeHolder: string,
): Promise<WorkspaceFolderChoice> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const [only, ...rest] = folders;
  if (only === undefined) return { kind: "none" };
  if (rest.length === 0) return { kind: "picked", folder: only };
  const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder });
  return folder === undefined
    ? { kind: "cancelled" }
    : { kind: "picked", folder };
}
