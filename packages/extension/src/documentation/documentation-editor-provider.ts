import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import {
  createShadowBuffer,
  type ShadowBuffer,
} from "../diagram/shadow-buffer.js";
import { DOCUMENTATION_VIEW_TYPE } from "../diagram/view-type.js";
import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "../webview/documentation-protocol.js";
import { createReadyGate, type ReadyGate } from "../webview/ready-gate.js";

import { docHtmlUriFor } from "./documentation-html-provider.js";
import { renderDocumentationWebviewHtml } from "./documentation-webview-html.js";

export { DOCUMENTATION_VIEW_TYPE };

/** The subset of OMC the documentation editor drives. */
interface DocumentationClient {
  getDocumentationAnnotation(input: {
    typeName: string;
  }): Promise<{ info: string; revision: string; infoHeader: string }>;
  setDocumentationAnnotation(input: {
    typeName: string;
    info: string;
    revisions: string;
  }): Promise<{ bool: boolean }>;
  listFile(input: { typeName: string }): Promise<{ contents: string }>;
  loadString(input: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
}

/**
 * Documentation custom editor: a `CustomTextEditorProvider` bound to `*.mo` that
 * renders and edits a class's `Documentation(info="<html>…</html>")` HTML. A
 * WYSIWYG edit rewrites the annotation through OMC (`setDocumentationAnnotation`)
 * and the class's canonical source is reflected back into the document via a
 * shadow buffer, so VSCode tracks dirty state and undo; a foreign buffer change
 * (undo/redo or a manual text edit) is `loadString`ed back into OMC and the
 * annotation re-fetched. A read-only class (an MSL library, or one carrying an
 * `__OpenModelica_infoHeader` the write API can't preserve) renders but rejects
 * edits.
 */
export class DocumentationEditorProvider
  implements vscode.CustomTextEditorProvider
{
  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<OmcClient>,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<OmcClient>,
    viewType: string,
  ): vscode.Disposable {
    const provider = new DocumentationEditorProvider(
      context.extensionUri,
      ensureClient,
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
    webview.html = renderPlaceholderHtml(webview.cspSource);
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
      const readOnlyBase = await isReadOnlyDocument(document);
      controller = new DocumentationEditController(
        { client, document, className, gate },
        readOnlyBase,
        (onForeignChange) => createShadowBuffer(document, onForeignChange),
      );
      controller.start();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `Failed to load documentation for ${className}: ${detail}`;
      gate.send({ type: "error", message });
      log.warn("documentationEditor", message);
    }
  })();
}

interface EditControllerDeps {
  client: DocumentationClient;
  document: vscode.TextDocument;
  className: string;
  gate: ReadyGate<DocExtensionToWebview>;
}

/** Deferred one-shot timer, injectable so tests drive the debounce directly. */
export interface Scheduler {
  schedule(fn: () => void, delayMs: number): { cancel(): void };
}

const defaultScheduler: Scheduler = {
  schedule(fn, delayMs) {
    const id = setTimeout(fn, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};

// Coalesce a burst of foreign changes (holding undo/redo, or typing in the text
// view) into one reverse sync once the buffer settles.
const REVERSE_SYNC_DEBOUNCE_MS = 150;

/**
 * Per-editor write controller. Forward: an `edit` from the webview carries the
 * full canonical `info`; it is written through `setDocumentationAnnotation`
 * (passing the current `revisions` back so that section isn't cleared), then the
 * class's canonical `listFile` source is reflected into the shadow buffer.
 * Reverse: a foreign buffer change is `loadString`ed back into OMC and the
 * annotation re-fetched and re-sent. Every unit runs through one serialized
 * queue so an edit can't diff against a half-applied reverse sync on the single
 * OMC socket.
 */
export class DocumentationEditController {
  private queue: Promise<void> = Promise.resolve();
  private readonly shadow: ShadowBuffer;
  private reverseTimer: { cancel(): void } | undefined;

  // The `revisions` section, remembered from the last fetch and passed on every
  // write — `setDocumentationAnnotation` clears any section it isn't given.
  private revision = "";
  // Whether edits are refused: an MSL/library source, or a class carrying an
  // `__OpenModelica_infoHeader` the write API would silently drop.
  private readOnly: boolean;

  constructor(
    private readonly deps: EditControllerDeps,
    private readonly readOnlyBase: boolean,
    makeShadow: (
      onForeignChange: (document: vscode.TextDocument) => void,
    ) => ShadowBuffer,
    private readonly scheduler: Scheduler = defaultScheduler,
  ) {
    this.readOnly = readOnlyBase;
    this.shadow = makeShadow(() => this.onForeignChange());
  }

  /** Fetch the annotation and seed the webview. */
  start(): void {
    void this.enqueue(async () => {
      try {
        await this.refetchAndSend();
      } catch (err) {
        this.reportError(
          `Failed to load documentation for ${this.deps.className}: ${detail(err)}`,
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
      this.reportError(`documentation edit failed: ${detail(err)}`);
    });
    return this.queue;
  }

  private async onEdit(info: string): Promise<void> {
    if (this.readOnly) {
      this.reportError("This class is read-only and can't be edited.");
      return;
    }
    const { client, className } = this.deps;
    const { bool } = await client.setDocumentationAnnotation({
      typeName: className,
      info,
      revisions: this.revision,
    });
    // The wrapper's `parseMutationSuccess` throws (→ the queue's catch surfaces
    // the OMC message) when OMC reports an error, so a bare `false` here means it
    // failed without one.
    if (!bool) {
      this.reportError("setDocumentationAnnotation returned false");
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
    const { client, document } = this.deps;
    try {
      // Drain stale diagnostics so the post-load `getErrorString` attributes
      // only errors this load produced.
      await client.getErrorString();
      const { success } = await client.loadString({
        data: document.getText(),
        filename: document.uri.toString(),
        merge: false,
      });
      if (!success) {
        const { errorString } = await client.getErrorString();
        this.reportError(
          `reverse sync rejected by OMC: ${errorString.trim() || "loadString returned success=false"}`,
        );
        return;
      }
      await this.refetchAndSend();
    } catch (err) {
      this.reportError(`reverse sync failed: ${detail(err)}`);
    }
  }

  private async refetchAndSend(): Promise<void> {
    const { client, className, gate } = this.deps;
    const { info, revision, infoHeader } =
      await client.getDocumentationAnnotation({ typeName: className });
    this.revision = revision;
    this.readOnly = this.readOnlyBase || infoHeader.trim().length > 0;
    gate.send({ type: "doc", className, info, readOnly: this.readOnly });
  }

  private reportError(message: string): void {
    this.deps.gate.send({ type: "error", message });
    log.warn("documentationEditor", message);
  }
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Open the class's `Documentation(info=…)` HTML in a native editor beside the
 * documentation view. The `modelica-doc:` provider serves it as an editable
 * `.html` file, so VSCode gives it HTML highlighting and formatting; saving
 * writes back through `setDocumentationAnnotation`.
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
      `Modelica: could not open the documentation HTML for ${className}: ${detail(err)}`,
    );
  }
}

/**
 * Whether the document's backing source is read-only — the source provider
 * reports `Readonly` for MSL / installed-library classes. Best-effort: a failed
 * stat is treated as writable so a transient error doesn't lock the editor.
 */
async function isReadOnlyDocument(
  document: vscode.TextDocument,
): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(document.uri);
    return ((stat.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0;
  } catch {
    return false;
  }
}

function renderPlaceholderHtml(cspSource: string): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${cspSource} 'unsafe-inline'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Modelica documentation</title>
    <style>
      body {
        margin: 0;
        height: 100dvh;
        display: grid;
        place-items: center;
        font-family: var(--vscode-font-family);
        color: var(--vscode-descriptionForeground);
      }
      p { max-width: 32rem; padding: 1rem; text-align: center; }
    </style>
  </head>
  <body>
    <p>Open a Modelica class from the library sidebar to see its documentation.</p>
  </body>
</html>`;
}
