/**
 * Finds the OpenModelica the extension will use, installs one when asked, and
 * says so.
 *
 * Resolution runs on every client spawn, so an `omc` the user points at takes
 * effect without a window reload. An install writes no setting (ADR 0002), so
 * nothing else would re-resolve after one: the flows below re-resolve
 * themselves, and the resulting `onOmcChanged` is what replaces the session.
 *
 * `modelica.omcPath` is written in exactly one place — the file picker below —
 * because it holds a human's stated choice and nothing else (ADR 0002).
 */

import * as os from "node:os";

import * as vscode from "vscode";

import {
  condaSubdir,
  managedRoot,
  OmcInstallError,
  resolveOmc,
  type FileProbe,
  type OmcResolution,
} from "@dicode/omc-bootstrap";
import { SUPPORTED_OMC, type CompatibilityReport } from "@dicode/omc-client";

import { errorDetail } from "./error-detail.js";
import { pathExists } from "./fs-util.js";
import { log } from "./logger.js";
import { nodeInstaller, type OmcInstaller } from "./omc-install-host.js";
import {
  foundOmcSentences,
  installDisclosure,
  installedMessage,
  installFailureMessage,
  installProgressMessage,
  missingOmcGuidance,
  omcStatus,
  removeConfirmation,
  removedMessage,
  removeFailedMessage,
  settingWinsMessage,
  verdictFor,
  verdictWarns,
  NO_MANAGED_INSTALL,
  type FoundOmc,
  type OmcVerdict,
} from "./omc-status.js";

const SETUP_COMMAND = "modelica.setupOmc";
const INSTALL_COMMAND = "modelica.installOmc";
const REMOVE_COMMAND = "modelica.removeOmc";
const SHOW_LOGS_COMMAND = "modelica.showLogs";

const LOCATE = "Locate omc...";
const DOWNLOAD = "Get OpenModelica";
const INSTALL = "Install for me";
const DETAILS = "Details";
const UPDATE = "Update OpenModelica";
const REMOVE = "Remove";
const SHOW_LOGS = "Show Logs";

const BUSY = "This extension is already installing or removing OpenModelica.";
const UNEXPECTED_FAILURE =
  "Installing OpenModelica failed unexpectedly. The log has the details.";

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
  readonly arch: NodeJS.Architecture;
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
    arch: process.arch,
    probe: pathExists,
  };
}

export interface OmcSetupOptions {
  readonly environment?: OmcEnvironment;
  /**
   * The resolved `omc` changed after the first resolution. A different binary
   * is a different symbol table, so the caller has a session to replace.
   */
  readonly onOmcChanged?: () => void;
  /** Injected so the flow around an install runs without a network or four gigabytes of disk. */
  readonly installer?: OmcInstaller;
}

export function createOmcSetup(options: OmcSetupOptions = {}): OmcSetup {
  const environment = options.environment ?? nodeEnvironment();
  const installer = options.installer ?? nodeInstaller();
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = SETUP_COMMAND;

  let resolution: OmcResolution = { source: "missing" };
  let verdict: OmcVerdict | undefined;
  let generation = 0;
  let resolvedOnce = false;
  let inFlight: Promise<void> | undefined;

  const root = (): string =>
    managedRoot(environment.homeDir, environment.platform);

  const installable = (): boolean =>
    condaSubdir(environment.platform, environment.arch) !== undefined;

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
        managedRoot: root(),
        pathVariable: environment.pathVariable,
        platform: environment.platform,
      },
      environment.probe,
    );
    // A `PATH` sweep that started earlier can land later; the newest answer is
    // the one the user is looking at.
    if (mine === generation) {
      const changed = resolvedOnce && resolved.omcPath !== resolution.omcPath;
      resolution = resolved;
      resolvedOnce = true;
      render();
      if (changed) options.onOmcChanged?.();
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

  async function openDownloadPage(): Promise<void> {
    await vscode.env.openExternal(
      vscode.Uri.parse(missingOmcGuidance(environment.platform).downloadPage),
    );
  }

  async function prompt(): Promise<void> {
    // The user reaching for this may have just installed the OpenModelica the
    // last resolution missed.
    const current = await resolve();
    if (current.source !== "missing") {
      await promptForFound(current);
      return;
    }

    const guidance = missingOmcGuidance(environment.platform);
    const choice = await vscode.window.showWarningMessage(
      guidance.message,
      ...(installable() ? [INSTALL, LOCATE, DETAILS] : [LOCATE, DOWNLOAD]),
    );
    if (choice === INSTALL) await install();
    if (choice === LOCATE) await locate();
    if (choice === DETAILS) await disclose();
    if (choice === DOWNLOAD) await openDownloadPage();
  }

  async function promptForFound(current: FoundOmc): Promise<void> {
    // An install loses to an explicit `modelica.omcPath`, so offering one to a
    // user who set it would spend four gigabytes on something never used.
    const level = verdictFor(current, verdict)?.level;
    const updatable =
      installable() &&
      current.source !== "setting" &&
      level !== undefined &&
      verdictWarns(level);

    const choice = await vscode.window.showInformationMessage(
      foundOmcSentences(current, verdict).join(" "),
      ...(updatable ? [UPDATE, LOCATE] : [LOCATE]),
    );
    if (choice === UPDATE) await install();
    if (choice === LOCATE) await locate();
  }

  async function disclose(): Promise<void> {
    const disclosure = installDisclosure(root());
    const choice = await vscode.window.showInformationMessage(
      disclosure.summary,
      { modal: true, detail: disclosure.detail },
      INSTALL,
    );
    if (choice === INSTALL) await install();
  }

  /**
   * One managed-install operation at a time in this window: a second install
   * would clear the staging prefix out from under the first, and a removal
   * would delete what that first one is building. Two windows share the root
   * and are not covered; the staged swap is what limits that.
   */
  function exclusive(operation: () => Promise<void>): Promise<void> {
    const running = inFlight;
    if (running !== undefined) {
      void vscode.window.showInformationMessage(BUSY);
      return running;
    }
    const started = operation().finally(() => {
      inFlight = undefined;
    });
    inFlight = started;
    return started;
  }

  /**
   * Everything that has to be true before an install is worth starting. Kept
   * outside the lock: each branch below can wait on the user, and a held lock
   * would answer an unrelated retry with {@link BUSY}.
   */
  async function install(): Promise<void> {
    if (!installable()) {
      const guidance = missingOmcGuidance(environment.platform);
      const choice = await vscode.window.showWarningMessage(
        environment.platform === "win32"
          ? guidance.message
          : NO_MANAGED_INSTALL,
        DOWNLOAD,
      );
      if (choice === DOWNLOAD) await openDownloadPage();
      return;
    }

    if ((await resolve()).source === "setting") {
      void vscode.window.showWarningMessage(settingWinsMessage());
      return;
    }

    return exclusive(runInstall);
  }

  async function runInstall(): Promise<void> {
    const controller = new AbortController();
    let cancelled = false;

    const outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Installing OpenModelica",
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          cancelled = true;
          controller.abort();
        });
        try {
          const installed = await installer.install(
            {
              homeDir: environment.homeDir,
              platform: environment.platform,
              arch: environment.arch,
              // The version the wrappers were audited against, so an install
              // can never produce one the status bar then warns about.
              version: SUPPORTED_OMC.primary,
              proxy: editorProxy(),
            },
            {
              report: (update) => {
                if (update.output !== undefined) {
                  log.info("omc", update.output.trimEnd());
                }
                progress.report({ message: installProgressMessage(update) });
              },
              signal: controller.signal,
            },
          );
          return { installed };
        } catch (err) {
          return { failure: err };
        }
      },
    );

    if (!("failure" in outcome)) {
      await resolve();
      // A cancel the installer raced past still landed a prefix, so the
      // resolution above stands; announcing it would answer a cancellation
      // with a success.
      if (!cancelled) {
        void vscode.window.showInformationMessage(
          installedMessage(outcome.installed.version, root()),
        );
      }
      return;
    }

    log.error("omc", "installing OpenModelica failed", outcome.failure);
    // The token the extension owns is the authority on cancellation.
    if (cancelled) return;
    void reportFailure(
      outcome.failure instanceof OmcInstallError
        ? installFailureMessage(outcome.failure)
        : UNEXPECTED_FAILURE,
    );
  }

  async function remove(): Promise<void> {
    const confirmation = removeConfirmation(root());
    const choice = await vscode.window.showWarningMessage(
      confirmation.summary,
      { modal: true, detail: confirmation.detail },
      REMOVE,
    );
    if (choice !== REMOVE) return;
    return exclusive(runRemove);
  }

  async function runRemove(): Promise<void> {
    try {
      const removed = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Removing OpenModelica",
        },
        () =>
          installer.remove({
            homeDir: environment.homeDir,
            platform: environment.platform,
          }),
      );
      await resolve();
      void vscode.window.showInformationMessage(removedMessage(removed));
    } catch (err) {
      log.error("omc", "removing OpenModelica failed", err);
      void reportFailure(removeFailedMessage(root()));
    }
  }

  /**
   * The proxy both legs of an install must route through. micromamba's libcurl
   * reads the ambient variables on its own, so without the same fallback here
   * the two legs of one install would take different routes.
   */
  function editorProxy(): string | undefined {
    const configured = vscode.workspace
      .getConfiguration("http")
      .get<string>("proxy")
      ?.trim();
    if (configured !== undefined && configured.length > 0) return configured;
    return (
      process.env.https_proxy ??
      process.env.HTTPS_PROXY ??
      process.env.http_proxy ??
      process.env.HTTP_PROXY
    );
  }

  async function reportFailure(message: string): Promise<void> {
    const choice = await vscode.window.showErrorMessage(message, SHOW_LOGS);
    if (choice === SHOW_LOGS) {
      await vscode.commands.executeCommand(SHOW_LOGS_COMMAND);
    }
  }

  const disposables = [
    item,
    vscode.commands.registerCommand(SETUP_COMMAND, () => prompt()),
    vscode.commands.registerCommand(INSTALL_COMMAND, () => install()),
    vscode.commands.registerCommand(REMOVE_COMMAND, () => remove()),
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
