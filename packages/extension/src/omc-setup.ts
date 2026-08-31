/**
 * Finds the OpenModelica the extension will use, and says so.
 *
 * Resolution runs again on every client spawn rather than once at activation,
 * so an `omc` the user points at takes effect without a window reload.
 *
 * `modelica.omcPath` is written in exactly one place — the file picker below —
 * because it holds a human's stated choice and nothing else (ADR 0002).
 */

import * as os from "node:os";

import * as vscode from "vscode";

import {
  managedRoot,
  resolveOmc,
  type OmcResolution,
} from "@dicode/omc-bootstrap";
import type { CompatibilityReport } from "@dicode/omc-client";

import { errorDetail } from "./error-detail.js";
import { pathExists } from "./fs-util.js";
import { log } from "./logger.js";
import { omcStatus, sourceSentence, type OmcVerdict } from "./omc-status.js";

const SETUP_COMMAND = "modelica.setupOmc";
/** Must match the title contributed for `SETUP_COMMAND` in `package.json`. */
const SETUP_TITLE = "Modelica: Set Up OpenModelica";
const DOWNLOAD_PAGE = "https://openmodelica.org/download/";

const LOCATE = "Locate omc...";
const DOWNLOAD = "Get OpenModelica";

/** The wrappers' compatibility verdict, from a connected client. */
interface VersionedClient {
  getVersionStatus(): Promise<CompatibilityReport>;
}

export interface OmcSetup extends vscode.Disposable {
  /** Resolve, show the result, and offer a way forward when there is none. */
  start(): Promise<void>;
  /**
   * The `omc` a spawn should use. Rejects when there is none, so the failure
   * every command surfaces names the missing dependency instead of `ENOENT`.
   */
  omcPath(): Promise<string>;
  /** Fill the version in, for the binary the client was spawned with. */
  reportVersion(client: VersionedClient, omcPath: string): Promise<void>;
}

export function createOmcSetup(): OmcSetup {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = SETUP_COMMAND;

  let resolution: OmcResolution = { source: "missing" };
  let verdict: OmcVerdict | undefined;
  let generation = 0;

  function render(): void {
    const status = omcStatus(resolution, verdict);
    item.text = status.text;
    item.tooltip = status.tooltip;
    item.backgroundColor = status.warn
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    item.show();
  }

  async function resolve(): Promise<OmcResolution> {
    const mine = ++generation;
    const resolved = await resolveOmc(
      {
        setting:
          vscode.workspace
            .getConfiguration("modelica")
            .get<string>("omcPath") ?? "",
        managedRoot: managedRoot(os.homedir(), process.platform),
        pathVariable: process.env.PATH ?? "",
        platform: process.platform,
      },
      pathExists,
    );
    // A `PATH` sweep that started earlier can land later; the newest answer is
    // the one the user is looking at.
    if (mine === generation) {
      resolution = resolved;
      render();
    }
    return resolved;
  }

  async function locate(): Promise<void> {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Use this omc",
      title: "Locate the omc binary",
    });
    const picked = picks?.[0];
    if (picked === undefined) return;
    await vscode.workspace
      .getConfiguration("modelica")
      .update("omcPath", picked.fsPath, vscode.ConfigurationTarget.Global);
  }

  async function prompt(): Promise<void> {
    // Re-resolve first: the user reaching for this may have just installed the
    // OpenModelica the last resolution missed.
    const current = await resolve();
    const choice =
      current.source === "missing"
        ? await vscode.window.showWarningMessage(
            "OpenModelica was not found. Modelica language features and simulation need it.",
            LOCATE,
            DOWNLOAD,
          )
        : await vscode.window.showInformationMessage(
            `${sourceSentence(current.source)} ${current.omcPath}`,
            LOCATE,
            DOWNLOAD,
          );
    if (choice === LOCATE) await locate();
    if (choice === DOWNLOAD) {
      await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_PAGE));
    }
  }

  const disposables = [
    item,
    vscode.commands.registerCommand(SETUP_COMMAND, () => prompt()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("modelica.omcPath")) void resolve();
    }),
  ];

  return {
    async start(): Promise<void> {
      // The notification fires once, here. A user who dismisses it is left the
      // status bar rather than a second prompt.
      if ((await resolve()).source === "missing") await prompt();
    },
    async omcPath(): Promise<string> {
      const resolved = await resolve();
      if (resolved.source === "missing") {
        throw new Error(
          `OpenModelica was not found. Run "${SETUP_TITLE}" to point the extension at it.`,
        );
      }
      return resolved.omcPath;
    },
    async reportVersion(
      client: VersionedClient,
      omcPath: string,
    ): Promise<void> {
      try {
        verdict = { omcPath, report: await client.getVersionStatus() };
        render();
      } catch (err) {
        log.warn("omc", `version status failed: ${errorDetail(err)}`);
      }
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
