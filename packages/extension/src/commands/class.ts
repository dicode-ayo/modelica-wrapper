/**
 * `modelica.createClass` — single entry point for creating any kind of
 * Modelica class. Quick-picks a kind (package / model / block / connector /
 * function / record / type), prompts for a name, then loads
 * `within Parent;\n<kind> Name\nend Name;\n` via OMC. On success, the class
 * is also materialized on disk under the workspace folder (creating any
 * missing `package.mo` parents as needed) and OMC's symbol-table fileName
 * is repointed at the new disk path via `setSourceFile`.
 *
 * Works from:
 *   - title bar (no parent → top-level class)
 *   - context menu on a library or package node (any depth → nested class)
 */

import * as vscode from "vscode";

import type { LibraryNode } from "../tree/library-tree.js";
import {
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "../source-provider.js";

import {
  parentFromNode,
  validateIdentifier,
  type CommandContext,
} from "./context.js";

const CLASS_KINDS = [
  "package",
  "model",
  "block",
  "connector",
  "function",
  "record",
  "type",
] as const;
type ClassKind = (typeof CLASS_KINDS)[number];

export function registerClassCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createClass",
      async (node?: LibraryNode) => {
        const parent = parentFromNode(node);
        const kind = (await vscode.window.showQuickPick([...CLASS_KINDS], {
          placeHolder: "Class kind",
          title: parent ? `New class inside ${parent}` : "New top-level class",
        })) as ClassKind | undefined;
        if (!kind) return;
        const name = await vscode.window.showInputBox({
          prompt: parent ? `New ${kind} inside ${parent}` : `New top-level ${kind}`,
          placeHolder: defaultPlaceholder(kind),
          validateInput: validateIdentifier,
        });
        if (!name) return;
        const qualified = parent ? `${parent}.${name}` : name;
        const body = `${kind} ${name}\nend ${name};\n`;
        const data = parent ? `within ${parent};\n${body}` : body;
        try {
          const c = await ctx.ensureClient();
          const { success } = await c.loadString({
            data,
            filename: `<runtime:${qualified}>`,
            merge: true,
          });
          if (!success) {
            const { errorString } = await c.getErrorString();
            await vscode.window.showErrorMessage(
              `Modelica: failed to create ${qualified}${errorString ? `: ${errorString}` : ""}`,
            );
            return;
          }
          const ws = vscode.workspace.workspaceFolders?.[0];
          if (ws) {
            // Persist to disk and rewrite OMC's fileName so subsequent
            // saves write through to the same path.
            const result = await persistClassUnderWorkspace(
              c,
              ws.uri.fsPath,
              qualified,
              data,
            );
            await linkPersistedClass(c, qualified, result);
          } else {
            await vscode.window.showWarningMessage(
              `Modelica: ${qualified} created in OMC memory only — open a folder to enable on-disk save.`,
            );
          }
          ctx.libraryTree.refresh();
          ctx.sourceProvider.notifySourceChanged();
        } catch (err) {
          await vscode.window.showErrorMessage(
            `Modelica: failed to create ${qualified}: ${(err as Error).message}`,
          );
        }
      },
    ),
  ];
}

function defaultPlaceholder(kind: ClassKind): string {
  return `My${kind[0]!.toUpperCase()}${kind.slice(1)}`;
}
