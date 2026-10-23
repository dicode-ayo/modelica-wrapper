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
 *   - title bar (no node → nests under the workspace root package when the
 *     root is one, otherwise top-level)
 *   - context menu on a library or package node (any depth → nested class)
 *
 * Refuses when `parent` is a system-library class (loaded from MODELICAPATH) —
 * persisting would extract a new file directly into an installed library's
 * directory. Also refuses a title-bar invocation whose workspace root is a
 * package OMC can't resolve to exactly one class — see
 * {@link resolveRootPackageParent}.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import {
  CLASS_KINDS,
  declareClass,
  linkPersistedClass,
  persistClass,
  resolveRootPackageParent,
  type ClassKind,
} from "@dicode/omc-client";

import { errorDetail } from "../error-detail.js";
import { pathExists } from "../fs-util.js";

import {
  parentFromNode,
  sanitizeIdentifier,
  validateIdentifier,
  type CommandContext,
  type LibraryNode,
} from "./context.js";
import { loadRootPackage } from "./package.js";
import { createReplLog } from "./repl.js";

export function registerClassCommands(
  ctx: CommandContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createClass",
      async (node?: LibraryNode) => {
        let parent = parentFromNode(node);
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

        if (!parent && ws) {
          const destination = await resolveTopLevelDestination(ctx, ws, name);
          if (!destination.ok) return;
          parent = destination.parent;
        }

        const qualified = parent ? `${parent}.${name}` : name;
        const log = createReplLog(`createClass ${kind} ${qualified}`);
        try {
          const c = await ctx.ensureClient();
          if (parent !== undefined) {
            // Creating here would persist a new file straight into an installed
            // MODELICAPATH library's directory.
            const verdict = await ctx.writeVerdicts.forClass(
              c,
              parent,
              "createInside",
            );
            if (!verdict.ok) {
              log.error(verdict.reason);
              await vscode.window.showErrorMessage(
                `Modelica: ${verdict.reason}`,
              );
              return;
            }
          }
          const declared = await declareClass(c, {
            name,
            kind,
            withinPath: parent,
          });
          if (!declared.ok) {
            log.error(declared.reason);
            await vscode.window.showErrorMessage(
              `Modelica: failed to create ${qualified}: ${declared.reason}`,
            );
            return;
          }
          let diskPath: string | undefined;
          if (ws) {
            // Persist to disk and rewrite OMC's fileName so subsequent
            // saves write through to the same path.
            const result = await persistClass(
              c,
              { root: ws.uri.fsPath, writer: ctx.selfWriteGuard },
              qualified,
              declared.source,
              kind,
            );
            await linkPersistedClass(c, qualified, result);
            diskPath = result.leafPath;
          } else {
            await vscode.window.showWarningMessage(
              `Modelica: ${qualified} created in OMC memory only — open a folder to enable on-disk save.`,
            );
          }
          ctx.libraryTree.childrenChanged(parent ?? null);
          ctx.sourceProvider.notifySourceChanged();
          log.success(
            diskPath
              ? `created ${qualified} → ${diskPath}`
              : `created ${qualified} (OMC memory only — no workspace folder)`,
          );
        } catch (err) {
          log.error(errorDetail(err));
          await vscode.window.showErrorMessage(
            `Modelica: failed to create ${qualified}: ${errorDetail(err)}`,
          );
        }
      },
    ),
  ];
}

/**
 * Where a title-bar (no tree node) `createClass` should land. `ok: false`
 * means the user was already told why, or dismissed a prompt, and the
 * command should stop; `parent: undefined` is a deliberate top-level create.
 */
type TopLevelDestination =
  { ok: true; parent: string | undefined } | { ok: false };

async function resolveTopLevelDestination(
  ctx: CommandContext,
  ws: vscode.WorkspaceFolder,
  name: string,
): Promise<TopLevelDestination> {
  const rootPkg = path.join(ws.uri.fsPath, "package.mo");
  if (await pathExists(rootPkg)) {
    // The workspace root is itself a package — per the discovery rules in
    // workspace-scan.ts, its package.mo is the ONLY entry point. A within-less
    // write here lands inside that package's own directory, and OMC refuses to
    // load the whole package on reload, not just the new file. There is
    // exactly one valid destination: nest under the root package.
    const rootLog = createReplLog("createClass resolve root package");
    try {
      const c = await ctx.ensureClient();
      const resolved = await resolveRootPackageParent(c, rootPkg);
      if (!resolved.ok) {
        rootLog.error(resolved.reason);
        await vscode.window.showErrorMessage(
          `Modelica: cannot create a top-level class here — ${resolved.reason}.`,
        );
        return { ok: false };
      }
      return { ok: true, parent: resolved.parent };
    } catch (err) {
      // Only ctx.ensureClient() can throw here — resolveRootPackageParent
      // catches its own failures and returns `{ ok: false }` — so this is an
      // OMC startup problem, not a workspace-layout one.
      rootLog.error(errorDetail(err));
      await vscode.window.showErrorMessage(
        `Modelica: failed to resolve the workspace root package: ${errorDetail(err)}`,
      );
      return { ok: false };
    }
  }
  if (await hasModelicaContent(ws.uri.fsPath))
    return { ok: true, parent: undefined };

  // First-time-only prompt: offer to make the workspace root a package when
  // there is no Modelica content yet and this would be top-level.
  const folderDefault = sanitizeIdentifier(path.basename(ws.uri.fsPath));
  const answer = await vscode.window.showInformationMessage(
    `The workspace folder has no Modelica content yet. ` +
      `Initialize "${folderDefault}" as a root package and nest "${name}" inside it?`,
    { modal: true },
    "Yes",
    "No",
  );
  // "No" or dismiss: proceed as top-level.
  if (answer !== "Yes") return { ok: true, parent: undefined };

  const pkgName = await vscode.window.showInputBox({
    prompt: "Root package name",
    value: folderDefault,
    validateInput: validateIdentifier,
  });
  if (!pkgName) return { ok: false };
  const pkgLog = createReplLog(`createClass package ${pkgName}`);
  try {
    const c = await ctx.ensureClient();
    const init = await loadRootPackage(c, ws.uri, pkgName, ctx.selfWriteGuard);
    if (!init.success) {
      pkgLog.error(init.errorString);
      await vscode.window.showErrorMessage(
        `Modelica: failed to initialize workspace package: ${init.errorString}`,
      );
      return { ok: false };
    }
    pkgLog.success(`initialized workspace as package ${pkgName}`);
    // The root listing changed the moment the package loaded; firing now keeps
    // the package visible even if creating the class inside it fails.
    ctx.libraryTree.childrenChanged(null);
    return { ok: true, parent: pkgName };
  } catch (err) {
    pkgLog.error(errorDetail(err));
    await vscode.window.showErrorMessage(
      `Modelica: failed to initialize workspace package: ${errorDetail(err)}`,
    );
    return { ok: false };
  }
}

/**
 * `expandable connector` has to suggest `MyExpandableConnector`, not a name
 * with a space in it that `validateIdentifier` would then reject.
 */
function defaultPlaceholder(kind: ClassKind): string {
  const camel = kind
    .split(" ")
    .map((word) => {
      const first = word.at(0);
      return first === undefined
        ? ""
        : `${first.toUpperCase()}${word.slice(1)}`;
    })
    .join("");
  return `My${camel}`;
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
