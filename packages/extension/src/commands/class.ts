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

import { pathExists } from "../fs-util.js";
import {
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "../source-provider.js";
import { moreThanOne, type FileParseClient } from "../single-entity-file.js";

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
          const rootPkg = path.join(ws.uri.fsPath, "package.mo");
          if (await pathExists(rootPkg)) {
            // The workspace root is itself a package — per the discovery
            // rules in workspace-scan.ts, its package.mo is the ONLY entry
            // point. A within-less write here lands inside that package's own
            // directory, and OMC refuses to load the whole package on
            // reload, not just the new file. There is exactly one valid
            // destination: nest under the root package.
            const rootLog = createReplLog("createClass resolve root package");
            try {
              const c = await ctx.ensureClient();
              const resolved = await resolveRootPackageParent(c, rootPkg);
              if (!resolved.ok) {
                rootLog.error(resolved.reason);
                await vscode.window.showErrorMessage(
                  `Modelica: cannot create a top-level class here — ${resolved.reason}.`,
                );
                return;
              }
              parent = resolved.parent;
            } catch (err) {
              // Only ctx.ensureClient() can throw here — resolveRootPackageParent
              // catches its own failures and returns `{ ok: false }` — so this
              // is an OMC startup problem, not a workspace-layout one.
              rootLog.error((err as Error).message);
              await vscode.window.showErrorMessage(
                `Modelica: failed to resolve the workspace root package: ${(err as Error).message}`,
              );
              return;
            }
          } else if (!(await hasModelicaContent(ws.uri.fsPath))) {
            // First-time-only prompt: offer to make the workspace root a
            // package when there is no Modelica content yet and this would
            // be top-level.
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
                const init = await loadRootPackage(
                  c,
                  ws.uri,
                  pkgName,
                  ctx.selfWriteGuard,
                );
                if (!init.success) {
                  pkgLog.error(init.errorString);
                  await vscode.window.showErrorMessage(
                    `Modelica: failed to initialize workspace package: ${init.errorString}`,
                  );
                  return;
                }
                pkgLog.success(`initialized workspace as package ${pkgName}`);
                parent = pkgName;
                // The root listing changed the moment the package loaded;
                // firing now keeps the package visible even if creating the
                // class inside it fails below.
                ctx.libraryTree.childrenChanged(null);
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
        }

        const qualified = parent ? `${parent}.${name}` : name;
        const body = `${kind} ${name}\nend ${name};\n`;
        const data = parent ? `within ${parent};\n${body}` : body;
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
              ctx.selfWriteGuard,
              kind === "package" ? "package" : undefined,
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
          log.error((err as Error).message);
          await vscode.window.showErrorMessage(
            `Modelica: failed to create ${qualified}: ${(err as Error).message}`,
          );
        }
      },
    ),
  ];
}

/** OMC surface {@link resolveRootPackageParent} needs. `OmcClient` satisfies it. */
export interface RootPackageClient extends FileParseClient {
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ restriction: string }>;
}

/**
 * The class `rootPkg` (an already-confirmed `<workspaceRoot>/package.mo`)
 * declares — the one destination a `view/title` invocation with no tree node
 * can mean once the workspace root is itself a package. Refuses rather than
 * guessing when the file doesn't parse to exactly one
 * top-level class, or when that class isn't actually loaded into OMC yet:
 * `parseFile` only reads the file off disk, and workspace autoload
 * (`workspace-autoload.ts`) loads entry files asynchronously — a title-bar
 * invocation right after opening the workspace, or right after a `:reset`,
 * could otherwise resolve a parent OMC hasn't loaded, and the `within`
 * merge that follows would fail against it.
 *
 * The load check only confirms a class named `name` is loaded, not that it's
 * specifically the one `rootPkg` declares — a same-named class loaded from
 * elsewhere would pass it too. `ctx.writeVerdicts.forClass`'s downstream
 * system-library check catches a MODELICAPATH collision; a same-named class
 * from another workspace file is a narrower case this doesn't distinguish.
 */
export async function resolveRootPackageParent(
  client: RootPackageClient,
  rootPkg: string,
): Promise<{ ok: true; parent: string } | { ok: false; reason: string }> {
  let classNames: string[];
  try {
    ({ classNames } = await client.parseFile({ fileName: rootPkg }));
  } catch (err) {
    return {
      ok: false,
      reason: `could not read ${rootPkg}'s class name (${(err as Error).message})`,
    };
  }
  const multiple = moreThanOne(classNames);
  if (multiple !== undefined) {
    return {
      ok: false,
      reason: `${rootPkg} declares more than one top-level class (${multiple.join(", ")})`,
    };
  }
  const [name] = classNames;
  if (name === undefined) {
    return {
      ok: false,
      reason: `${rootPkg} declares no class OMC could parse`,
    };
  }
  try {
    const info = await client.getClassInformation({ typeName: name });
    // A not-yet-loaded class doesn't reject — OMC 1.27.0 answers with every
    // field defaulted (empty `restriction` among them) rather than an error
    // (see packages/omc-client/src/api/browsing/getClassInformation.test.ts's
    // `NOT_FOUND_18` fixture). Every real class restriction (model, package,
    // block, …) is non-empty, so that's the signal to key off instead of a
    // thrown rejection.
    if (info.restriction === "") {
      return {
        ok: false,
        reason: `no class named ${name} is loaded into OMC yet — wait for the workspace to finish loading and try again`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `could not confirm ${name} is loaded into OMC (${(err as Error).message})`,
    };
  }
  return { ok: true, parent: name };
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
