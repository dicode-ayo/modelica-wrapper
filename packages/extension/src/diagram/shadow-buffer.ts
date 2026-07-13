import * as vscode from "vscode";

/**
 * The editor's `TextDocument` shadows the OMC AST: after each graphical edit
 * mutates OMC, the class's canonical `listFile` source is written back into the
 * document so VSCode's dirty state and undo history track the change.
 */
export interface ShadowBuffer {
  /** Reflect canonical OMC source into the document as a guarded self-write. */
  write(text: string): Promise<void>;
  dispose(): void;
}

/**
 * Create a shadow buffer over `document`.
 *
 * A `write` replaces the whole document and flags the change as ours; the
 * `onDidChangeTextDocument` guard then skips it. Any change NOT flagged is
 * foreign — a manual text edit or an undo/redo — and is handed to
 * `onForeignChange`. Distinguishing the two matters because a self-write that
 * fed back into OMC would ping-pong: reflect → change event → re-sync → reflect.
 */
export function createShadowBuffer(
  document: vscode.TextDocument,
  onForeignChange: (document: vscode.TextDocument) => void,
): ShadowBuffer {
  let selfWriteInFlight = false;

  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== document.uri.toString()) return;
    if (selfWriteInFlight) return;
    onForeignChange(e.document);
  });

  return {
    async write(text) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        text,
      );
      selfWriteInFlight = true;
      try {
        await vscode.workspace.applyEdit(edit);
      } finally {
        selfWriteInFlight = false;
      }
    },
    dispose() {
      sub.dispose();
    },
  };
}
