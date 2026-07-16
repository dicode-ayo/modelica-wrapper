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

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import { pathExists } from "../fs-util.js";
import {
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "../source-provider.js";

import {
  parentFromNode,
  sanitizeIdentifier,
  validateIdentifier,
  type CommandContext,
  type LibraryNode,
} from "./context.js";
import { loadRootPackage } from "./package.js";
import { createReplLog } from "./repl.js";

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

export function registerClassCommands(
  ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createClass",
      async (node?: LibraryNode) => {
        let parent = parentFromNode(node);
        let createdRootPackage = false;
        const kind = (await vscode.window.showQuickPick([...CLASS_KINDS], {
          placeHolder: "Class kind",
          title: parent ? `New class inside ${parent}` : "New top-level class",
        })) as ClassKind | undefined;
        if (!kind) return;
        const name = await vscode.window.showInputBox({
          prompt: parent
            ? `New ${kind} inside ${parent}`
            : `New top-level ${kind}`,
          placeHolder: defaultPlaceholder(kind),
          validateInput: validateIdentifier,
        });
        if (!name) return;

        const ws = vscode.workspace.workspaceFolders?.[0];

        // First-time-only prompt: offer to make the workspace root a package
        // when there is no Modelica content yet and this would be top-level.
        if (!parent && ws && !(await hasModelicaContent(ws.uri.fsPath))) {
          const folderDefault = sanitizeIdentifier(
            path.basename(ws.uri.fsPath),
          );
          const answer = await vscode.window.showInformationMessage(
            `The workspace folder has no Modelica content yet. ` +
              `Initialize "${folderDefault}" as a root package and nest "${name}" inside it?`,
            { modal: true },
            "Yes",
            "No",
          );
          if (answer === "Yes") {
            const pkgName = await vscode.window.showInputBox({
              prompt: "Root package name",
              value: folderDefault,
              validateInput: validateIdentifier,
            });
            if (!pkgName) return;
            const pkgLog = createReplLog(`createClass package ${pkgName}`);
            try {
              const c = await ctx.ensureClient();
              const init = await loadRootPackage(c, ws.uri, pkgName);
              if (!init.success) {
                pkgLog.error(init.errorString);
                await vscode.window.showErrorMessage(
                  `Modelica: failed to initialize workspace package: ${init.errorString}`,
                );
                return;
              }
              pkgLog.success(`initialized workspace as package ${pkgName}`);
              parent = pkgName;
              createdRootPackage = true;
            } catch (err) {
              pkgLog.error((err as Error).message);
              await vscode.window.showErrorMessage(
                `Modelica: failed to initialize workspace package: ${(err as Error).message}`,
              );
              return;
            }
          }
          // "No" or dismiss: proceed as top-level (parent stays undefined).
        }

        const qualified = parent ? `${parent}.${name}` : name;
        const body = `${kind} ${name}\nend ${name};\n`;
        const data = parent ? `within ${parent};\n${body}` : body;
        const log = createReplLog(`createClass ${kind} ${qualified}`);
        try {
          const c = await ctx.ensureClient();
          const { success } = await c.loadString({
            data,
            filename: `<runtime:${qualified}>`,
            merge: true,
          });
          if (!success) {
            const { errorString } = await c.getErrorString();
            log.error(errorString || "loadString returned success=false");
            await vscode.window.showErrorMessage(
              `Modelica: failed to create ${qualified}${errorString ? `: ${errorString}` : ""}`,
            );
            return;
          }
          let diskPath: string | undefined;
          if (ws) {
            // Persist to disk and rewrite OMC's fileName so subsequent
            // saves write through to the same path.
            const result = await persistClassUnderWorkspace(
              c,
              ws.uri.fsPath,
              qualified,
              data,
              kind === "package" ? "package" : undefined,
            );
            await linkPersistedClass(c, qualified, result);
            diskPath = result.leafPath;
          } else {
            await vscode.window.showWarningMessage(
              `Modelica: ${qualified} created in OMC memory only — open a folder to enable on-disk save.`,
            );
          }
          // A freshly-initialized root package appears at the root; the new
          // class inside it lists on first expand (nothing cached yet).
          // Otherwise only the parent's child list grew.
          ctx.libraryTree.childrenChanged(
            createdRootPackage ? null : (parent ?? null),
          );
          ctx.sourceProvider.notifySourceChanged();
          log.success(
            diskPath
              ? `created ${qualified} → ${diskPath}`
              : `created ${qualified} (OMC memory only — no workspace folder)`,
          );
        } catch (err) {
          log.error((err as Error).message);
          await vscode.window.showErrorMessage(
            `Modelica: failed to create ${qualified}: ${(err as Error).message}`,
          );
        }
      },
    ),
  ];
}

function defaultPlaceholder(kind: ClassKind): string {
  const first = kind.at(0);
  if (first === undefined) return "My";
  return `My${first.toUpperCase()}${kind.slice(1)}`;
}

/**
 * Returns true if `wsPath` already contains any `.mo` file or a subdirectory
 * `package.mo`. Used to decide whether the first-create prompt should fire.
 */
async function hasModelicaContent(wsPath: string): Promise<boolean> {
  let entries;
  try {
    entries = await fsp.readdir(wsPath, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile() && entry.name.endsWith(".mo")) return true;
    if (entry.isDirectory()) {
      if (await pathExists(path.join(wsPath, entry.name, "package.mo"))) {
        return true;
      }
    }
  }
  return false;
}
