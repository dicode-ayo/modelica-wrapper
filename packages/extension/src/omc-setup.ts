/**
 * Finds the OpenModelica the extension will use, and says so.
 *
 * Resolution runs on every client spawn, so an `omc` the user points at takes
 * effect without a window reload.
 *
 * `modelica.omcPath` is written in exactly one place — the file picker below —
 * because it holds a human's stated choice and nothing else (ADR 0002).
 */

import * as os from "node:os";

import * as vscode from "vscode";

import {
  managedRoot,
  resolveOmc,
  type FileProbe,
  type OmcResolution,
} from "@dicode/omc-bootstrap";
import type { CompatibilityReport } from "@dicode/omc-client";

import { errorDetail } from "./error-detail.js";
import { pathExists } from "./fs-util.js";
import { log } from "./logger.js";
import {
  missingOmcGuidance,
  omcStatus,
  sourceSentence,
  type OmcVerdict,
} from "./omc-status.js";

const SETUP_COMMAND = "modelica.setupOmc";

const LOCATE = "Locate omc...";
const DOWNLOAD = "Get OpenModelica";

/** The wrappers' compatibility verdict, from a connected client. */
interface VersionedClient {
  getVersionStatus(): Promise<CompatibilityReport>;
}

/**
 * The ambient facts resolution reads. Injected so the platform and the disk are
 * both answerable from a test on any host, as they are in `omc-bootstrap`.
 */
export interface OmcEnvironment {
  readonly homeDir: string;
  readonly pathVariable: string;
  readonly platform: NodeJS.Platform;
  readonly probe: FileProbe;
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

export function nodeEnvironment(): OmcEnvironment {
  return {
    homeDir: os.homedir(),
    pathVariable: process.env.PATH ?? "",
    platform: process.platform,
    probe: pathExists,
  };
}

export function createOmcSetup(
  environment: OmcEnvironment = nodeEnvironment(),
): OmcSetup {
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
        managedRoot: managedRoot(environment.homeDir, environment.platform),
        pathVariable: environment.pathVariable,
        platform: environment.platform,
      },
      environment.probe,
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
    // The user reaching for this may have just installed the OpenModelica the
    // last resolution missed.
    const current = await resolve();
    if (current.source !== "missing") {
      const choice = await vscode.window.showInformationMessage(
        `${sourceSentence(current.source)} ${current.omcPath}`,
        LOCATE,
      );
      if (choice === LOCATE) await locate();
      return;
    }

    const guidance = missingOmcGuidance(environment.platform);
    const choice = await vscode.window.showWarningMessage(
      guidance.message,
      LOCATE,
      DOWNLOAD,
    );
    if (choice === LOCATE) await locate();
    if (choice === DOWNLOAD) {
      await vscode.env.openExternal(vscode.Uri.parse(guidance.downloadPage));
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
      // The only site that notifies; the status bar carries it from here on.
      if ((await resolve()).source === "missing") await prompt();
    },
    async omcPath(): Promise<string> {
      const resolved = await resolve();
      if (resolved.source === "missing") {
        throw new Error(
          "OpenModelica was not found. Set one up from the OpenModelica status bar item.",
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
