import * as vscode from "vscode";

import type { ModelInstance, OmcClient } from "@dicode/omc-client";
import type { DocumentationInterface } from "@dicode/documentation-ui/interface-model";

import {
  defaultScheduler,
  reloadBufferIntoOmc,
  REVERSE_SYNC_DEBOUNCE_MS,
  type BufferSyncClient,
  type Scheduler,
} from "../diagram/buffer-sync.js";
import {
  createShadowBuffer,
  type ShadowBuffer,
} from "../diagram/shadow-buffer.js";
import { DOCUMENTATION_VIEW_TYPE } from "../diagram/view-type.js";
import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "../webview/documentation-protocol.js";
import { createReadyGate, type ReadyGate } from "../webview/ready-gate.js";
import { renderPlaceholderPage } from "../webview/webview-page.js";
import type {
  WriteVerdict,
  WriteVerdictClient,
  WriteVerdicts,
} from "../write-verdict.js";

import { docHtmlUriFor } from "./documentation-html-provider.js";
import { buildDocumentationInterface } from "./documentation-interface.js";
import { openModelicaLink } from "./documentation-link.js";
import { resolveDocResources } from "./documentation-resources.js";
import { renderDocumentationWebviewHtml } from "./documentation-webview-html.js";

export { DOCUMENTATION_VIEW_TYPE };

/** The subset of OMC the documentation editor drives. */
export interface DocumentationClient
  extends BufferSyncClient, WriteVerdictClient {
  getDocumentationAnnotation(input: {
    typeName: string;
  }): Promise<{ info: string }>;
  getClassRestriction(input: {
    typeName: string;
  }): Promise<{ restriction: string }>;
  getModelInstance(input: {
    typeName: string;
  }): Promise<{ instance: ModelInstance }>;
  setFullDocumentationAnnotation(input: {
    typeName: string;
    info: string;
  }): Promise<{ success: boolean }>;
  listFile(input: { typeName: string }): Promise<{ contents: string }>;
  uriToFilename(input: { uri: string }): Promise<{ filename: string }>;
}

/**
 * Documentation custom editor: a `CustomTextEditorProvider` bound to `*.mo` that
 * renders and edits a class's `Documentation(info="<html>…</html>")` HTML. A
 * WYSIWYG edit rewrites the annotation through OMC
 * (`setFullDocumentationAnnotation`) and the class's canonical source is
 * reflected back into the document via a shadow buffer, so VSCode tracks
 * dirty state and undo; a foreign buffer change (undo/redo or a manual text
 * edit) is `loadString`ed back into OMC and the annotation re-fetched. A
 * read-only class (an MSL library) renders but rejects edits.
 */
export class DocumentationEditorProvider
  implements vscode.CustomTextEditorProvider
{
  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<OmcClient>,
    private readonly writeVerdicts: WriteVerdicts,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<OmcClient>,
    writeVerdicts: WriteVerdicts,
    viewType: string,
  ): vscode.Disposable {
    const provider = new DocumentationEditorProvider(
      context.extensionUri,
      ensureClient,
      writeVerdicts,
    );
    return vscode.window.registerCustomEditorProvider(viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    resolveDocumentationEditor(
      webviewPanel,
      this.extensionUri,
      this.ensureClient,
      this.writeVerdicts,
      document,
    );
  }

  // ── Active-editor registry ──────────────────────────────────────────────
  // Tracks the focused documentation editor so the title-bar view switcher can
  // resolve its class when flipping away from the documentation view.
  private static activeToken: object | undefined;
  private static activeName: string | undefined;

  /** Class of the focused documentation editor, or undefined when none is. */
  static activeClassName(): string | undefined {
    return DocumentationEditorProvider.activeName;
  }

  static setActive(token: object, className: string): void {
    DocumentationEditorProvider.activeToken = token;
    DocumentationEditorProvider.activeName = className;
  }

  static clearActive(token: object): void {
    if (DocumentationEditorProvider.activeToken === token) {
      DocumentationEditorProvider.activeToken = undefined;
      DocumentationEditorProvider.activeName = undefined;
    }
  }
}

/**
 * Wire a resolved documentation editor onto its webview panel: resolve the class
 * the `.mo` document stands for, boot the documentation-ui bundle, seed it with
 * the class's `info` HTML once the webview signals `ready`, and route edits
 * through a write controller. A document whose class can't be resolved renders a
 * static placeholder.
 */
export function resolveDocumentationEditor(
  webviewPanel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  ensureClient: () => Promise<OmcClient>,
  writeVerdicts: WriteVerdicts,
  document: vscode.TextDocument,
): void {
  const { webview } = webviewPanel;
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
  };

  // The `modelica-source:` scheme encodes the class in its path. A bare `file:`
  // `.mo` carries no such mapping, so it renders a placeholder rather than
  // guessing a class.
  const className = qualifiedNameFromUri(document.uri);
  if (className === undefined) {
    webview.html = renderPlaceholderPage({
      cspSource: webview.cspSource,
      title: "Modelica documentation",
      message:
        "Open a Modelica class from the library sidebar to see its documentation.",
    });
    return;
  }

  const gate = createReadyGate<DocExtensionToWebview>(webview);
  let controller: DocumentationEditController | undefined;
  const sub = webview.onDidReceiveMessage((msg: DocWebviewToExtension) => {
    if (msg.type === "ready") {
      gate.markReady();
      return;
    }
    if (msg.type === "editSource") {
      void openHtmlSourceEditor(className);
      return;
    }
    if (msg.type === "openLink") {
      void openModelicaLink(msg.href, ensureClient);
      return;
    }
    void controller?.handle(msg);
  });

  const token = {};
  const viewStateSub = webviewPanel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) {
      DocumentationEditorProvider.setActive(token, className);
    } else {
      DocumentationEditorProvider.clearActive(token);
    }
  });
  webviewPanel.onDidDispose(() => {
    sub.dispose();
    viewStateSub.dispose();
    DocumentationEditorProvider.clearActive(token);
    if (controller) unregisterController(className, controller);
    controller?.dispose();
  });
  if (webviewPanel.active) {
    DocumentationEditorProvider.setActive(token, className);
  }

  webview.html = renderDocumentationWebviewHtml(
    webview,
    extensionUri,
    className,
  );

  void (async (): Promise<void> => {
    try {
      const client: DocumentationClient = await ensureClient();
      controller = new DocumentationEditController(
        { client, document, className, gate, writeVerdicts },
        (onForeignChange) => createShadowBuffer(document, onForeignChange),
      );
      registerController(className, controller);
      controller.start();
    } catch (err) {
      const message = `Failed to load documentation for ${className}: ${errorDetail(err)}`;
      gate.send({ type: "error", message });
      log.warn("documentationEditor", message);
    }
  })();
}

// Focused-class → controller, so a write from the native HTML editor can re-sync
// the open webview through its serialized queue instead of relying on VSCode's
// (dirty-gated) buffer revert.
const controllers = new Map<string, DocumentationEditController>();

function registerController(
  className: string,
  controller: DocumentationEditController,
): void {
  controllers.set(className, controller);
}

function unregisterController(
  className: string,
  controller: DocumentationEditController,
): void {
  if (controllers.get(className) === controller) controllers.delete(className);
}

/** Re-sync the open documentation webview after an external write to `className`. */
export function notifyDocumentationChanged(className: string): void {
  void controllers.get(className)?.refreshFromExternalWrite();
}

interface EditControllerDeps {
  client: DocumentationClient;
  writeVerdicts: WriteVerdicts;
  document: vscode.TextDocument;
  className: string;
  gate: ReadyGate<DocExtensionToWebview>;
}

/**
 * Class restrictions whose interface sections are worth a full instantiate.
 * Anything else — packages, functions, `type` aliases, the builtins — is
 * skipped without touching `getModelInstance` (see `fetchInterface`).
 */
const INTERFACE_RESTRICTIONS: ReadonlySet<string> = new Set([
  "model",
  "block",
  "class",
  "connector",
  "expandable connector",
  "record",
  "operator record",
]);

/**
 * Per-editor write controller. Forward: an `edit` from the webview carries the
 * new `info`; it is written through `setFullDocumentationAnnotation`, which
 * reads the class's current `revisions`/`infoHeader` itself and reconstructs
 * the whole annotation so neither section is cleared, then the class's
 * canonical `listFile` source is reflected into the shadow buffer. Reverse: a
 * foreign buffer change is `loadString`ed back into OMC and the annotation
 * re-fetched and re-sent. Every unit runs through one serialized queue so an
 * edit can't diff against a half-applied reverse sync on the single OMC
 * socket.
 */
export class DocumentationEditController {
  private queue: Promise<void> = Promise.resolve();
  private readonly shadow: ShadowBuffer;
  private reverseTimer: { cancel(): void } | undefined;

  // A successful fetch confirms the class resolved to something real. An edit
  // before that is refused rather than targeting a not-yet-confirmed class.
  private seeded = false;

  // Safe default until `refetchAndSend` resolves the class and judges it.
  private verdict: WriteVerdict = {
    ok: false,
    reason: "The class hasn't loaded yet.",
  };

  constructor(
    private readonly deps: EditControllerDeps,
    makeShadow: (
      onForeignChange: (document: vscode.TextDocument) => void,
    ) => ShadowBuffer,
    private readonly scheduler: Scheduler = defaultScheduler,
  ) {
    this.shadow = makeShadow(() => this.onForeignChange());
  }

  /** Fetch the annotation and seed the webview. */
  start(): void {
    void this.enqueue(async () => {
      try {
        await this.refetchAndSend();
      } catch (err) {
        this.reportError(
          `Failed to load documentation for ${this.deps.className}: ${errorDetail(err)}`,
        );
      }
    });
  }

  handle(msg: DocWebviewToExtension): Promise<void> {
    if (msg.type !== "edit") return Promise.resolve();
    const { info } = msg;
    return this.enqueue(() => this.onEdit(info));
  }

  dispose(): void {
    this.reverseTimer?.cancel();
    this.shadow.dispose();
  }

  private enqueue(unit: () => Promise<void>): Promise<void> {
    // A single rejection would sever the chain, so the one place the chain is
    // built is the one place the catch belongs.
    this.queue = this.queue.then(unit).catch((err) => {
      this.reportError(`documentation edit failed: ${errorDetail(err)}`);
    });
    return this.queue;
  }

  /**
   * Re-sync after the class's documentation was written elsewhere (the native
   * HTML editor): reflect the canonical source into the buffer — even a dirty
   * one, through the self-write guard — and re-send the fresh annotation so the
   * webview can't hold a stale `info` and clobber the write on its next edit.
   * A read-only class skips the reflect (nothing should have written it in the
   * first place) but still re-sends, so the webview can't be left holding a
   * stale `info`/`readOnly` state.
   */
  refreshFromExternalWrite(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.rejectIfReadOnly()) await this.reflect();
      await this.refetchAndSend();
    });
  }

  /** Reject an edit against a class the write verdict refuses. */
  private rejectIfReadOnly(): boolean {
    if (this.verdict.ok) return false;
    this.reportError(this.verdict.reason);
    return true;
  }

  private async onEdit(info: string): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    if (!this.seeded) {
      this.reportError("Documentation hasn't loaded yet; edit discarded.");
      return;
    }
    const { client, className } = this.deps;
    const { success } = await client.setFullDocumentationAnnotation({
      typeName: className,
      info,
    });
    if (!success) {
      this.reportError("setFullDocumentationAnnotation returned false");
      return;
    }
    await this.reflect();
  }

  /** Reflect the class's canonical OMC source into the shadow buffer. */
  private async reflect(): Promise<void> {
    const { contents } = await this.deps.client.listFile({
      typeName: this.deps.className,
    });
    // A built-in with no listable source returns empty; writing that would wipe
    // the buffer.
    if (contents.length > 0) await this.shadow.write(contents);
  }

  private onForeignChange(): void {
    this.reverseTimer?.cancel();
    this.reverseTimer = this.scheduler.schedule(() => {
      this.reverseTimer = undefined;
      void this.enqueue(() => this.reverseSync());
    }, REVERSE_SYNC_DEBOUNCE_MS);
  }

  /**
   * Reload the buffer's text into OMC (replacing the class) and re-send the
   * re-fetched annotation. No reflect back to the buffer: the buffer is already
   * the source of this change, and writing it would fight VSCode's undo.
   */
  private async reverseSync(): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    const { client, className, document } = this.deps;
    try {
      const reload = await reloadBufferIntoOmc(client, document, className);
      if (!reload.ok) {
        this.reportError(reload.message);
        return;
      }
      await this.refetchAndSend();
    } catch (err) {
      this.reportError(`reverse sync failed: ${errorDetail(err)}`);
    }
  }

  private async refetchAndSend(): Promise<void> {
    const { client, className, gate, document } = this.deps;
    const { info } = await client.getDocumentationAnnotation({
      typeName: className,
    });
    this.seeded = true;
    // Evaluated after the fetch, which resolves a not-yet-loaded class (a
    // restored tab): a verdict taken earlier would read as writable and strand
    // the editor in edit mode for a system-library class.
    this.verdict = await this.deps.writeVerdicts.forDocument(
      client,
      document,
      className,
      "edit",
    );
    const resources = await resolveDocResources(client, info);
    gate.send({
      type: "doc",
      className,
      info,
      readOnly: !this.verdict.ok,
      resources,
    });
    // The interface follows in its own message so the HTML paints without
    // waiting on the (comparatively slow) full instantiate.
    const iface = await this.fetchInterface();
    if (iface !== undefined) {
      gate.send({ type: "interface", className, interface: iface });
    }
  }

  /**
   * Derive the auto-generated interface sections from the class's instance
   * tree. Best-effort: a class that can't instantiate (a partial or erroring
   * class) drops the sections rather than blanking the documentation.
   *
   * Gated on the cheap `getClassRestriction` lookup: the full instantiate
   * costs seconds on deep hierarchies and never returns for the builtins
   * (`fetchIconLayout` documents the same hazard), and the OMC socket is
   * serialized, so a hung call wedges every later one. Nothing on this path
   * may block the doc render.
   */
  private async fetchInterface(): Promise<DocumentationInterface | undefined> {
    const { client, className } = this.deps;
    try {
      const { restriction } = await client.getClassRestriction({
        typeName: className,
      });
      if (!INTERFACE_RESTRICTIONS.has(restriction)) return undefined;
      const { instance } = await client.getModelInstance({
        typeName: className,
      });
      return buildDocumentationInterface(instance);
    } catch (err) {
      log.warn(
        "documentationEditor",
        `interface unavailable for ${className}: ${errorDetail(err)}`,
      );
      return undefined;
    }
  }

  private reportError(message: string): void {
    this.deps.gate.send({ type: "error", message });
    log.warn("documentationEditor", message);
  }
}

/**
 * Open the class's `Documentation(info=…)` HTML in a native editor beside the
 * documentation view. The `modelica-doc:` provider serves it as an editable
 * `.html` file, so VSCode gives it HTML highlighting and formatting; saving
 * writes back through `setFullDocumentationAnnotation`.
 */
async function openHtmlSourceEditor(className: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(
      docHtmlUriFor(className),
    );
    await vscode.languages.setTextDocumentLanguage(doc, "html");
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
    });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Modelica: could not open the documentation HTML for ${className}: ${errorDetail(err)}`,
    );
  }
}
