import * as vscode from "vscode";

import type {
  ClassDef,
  ComponentElement,
  DiagramLayout,
  OmcClient,
  Shape,
} from "@dicode/omc-client";
import { produceSimulationModel } from "@dicode/omc-client";

import { assertUnreachable } from "@dicode/modelica-lang-core";

import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import {
  iconHonorsGesture,
  isGestureMessage,
  type ParameterFormKind,
  type WebviewToExtension,
} from "../webview/gestures.js";
import type {
  DiagramCommandId,
  ExtensionToWebview,
} from "../webview/protocol.js";
import { createReadyGate, type ReadyGate } from "../webview/ready-gate.js";
import { renderPlaceholderPage } from "../webview/webview-page.js";
import type { WriteVerdict, WriteVerdicts } from "../write-verdict.js";

import { applyEdits } from "./apply-edits.js";
import {
  diagramClipboard,
  type ClipboardEntry,
  type DiagramClipboard,
} from "./clipboard.js";
import {
  captureClipboardItems,
  pastedSelectionKeys,
  pasteClipboardItems,
} from "./copy-paste.js";
import {
  defaultScheduler,
  reloadBufferIntoOmc,
  REVERSE_SYNC_DEBOUNCE_MS,
  type Scheduler,
} from "./buffer-sync.js";
import {
  lineAnnotation,
  type GraphicsLayer,
  type LayoutEdit,
} from "./diff-layout.js";
import { renderDiagramWebviewHtml } from "./diagram-webview-html.js";
import { parseKey } from "@dicode/diagram-ui/entity-keys";
import { LibrarySource } from "./library-source.js";
import {
  applyClassParameterEdits,
  applyComponentParameterEdits,
  applyDiagramEdits,
  buildClassUnitTable,
  buildComponentUnitTable,
  fetchDiagramLayout,
  fetchIconLayout,
  fetchModelInstance,
  fetchSimulationOptions,
  keyToCref,
  layoutFromInstance,
  guardAddComponent,
  pickClassToSwap,
  placementAt,
  resetComponentParameters,
  runSimulate,
  uniqueComponentName,
} from "./open-diagram.js";
import {
  buildClassParameterForm,
  buildComponentParameterForm,
  findSubComponent,
  type ClassParameterRef,
  type ComponentParameterRef,
} from "./parameter-edits.js";
import { createShadowBuffer, type ShadowBuffer } from "./shadow-buffer.js";
import {
  applyShapeProperties,
  buildShapePropertiesForm,
  lookupHostShape,
} from "./shape-properties.js";
import { setInputFocusContext } from "./input-focus.js";
import {
  DIAGRAM_VIEW_TYPE,
  ICON_VIEW_TYPE,
  type DiagramMode,
} from "./view-type.js";

export { DIAGRAM_VIEW_TYPE, ICON_VIEW_TYPE };

/**
 * Resolve the Modelica class a `.mo` document stands for. The
 * `modelica-source:` virtual scheme encodes the dotted name in its path; a
 * real `file:` `.mo` carries no such mapping, so it returns `undefined` and
 * the editor shows a placeholder rather than guessing a class.
 */
export function classNameFromDocument(
  document: vscode.TextDocument,
): string | undefined {
  return qualifiedNameFromUri(document.uri);
}

/**
 * Diagram custom editor: a `CustomTextEditorProvider` bound to `*.mo` that
 * renders a class's graphics from OMC. In `"diagram"` mode it renders the
 * component graph and applies graphical edits — edits mutate the OMC AST (the
 * render model), and the class's canonical source is reflected back into the
 * document through a shadow buffer so VSCode tracks dirty state and undo; a
 * foreign buffer change (undo/redo or a manual text edit) is `loadString`ed
 * back into OMC and the layout re-fetched, and save flushes the reflected
 * buffer through its document provider. In `"icon"` mode it renders and edits
 * the class's own icon annotation, sharing the same machinery but honoring only
 * icon-appropriate edits: drawing/editing primitive shapes on the icon layer and
 * placing connectors.
 */
export class DiagramEditorProvider implements vscode.CustomTextEditorProvider {
  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<OmcClient>,
    private readonly writeVerdicts: WriteVerdicts,
    private readonly mode: DiagramMode,
    private readonly onClassContentChanged?: (className: string) => void,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<OmcClient>,
    writeVerdicts: WriteVerdicts,
    viewType: string,
    mode: DiagramMode,
    onClassContentChanged?: (className: string) => void,
  ): vscode.Disposable {
    const provider = new DiagramEditorProvider(
      context.extensionUri,
      ensureClient,
      writeVerdicts,
      mode,
      onClassContentChanged,
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
    resolveDiagramEditor(
      webviewPanel,
      this.extensionUri,
      this.ensureClient,
      this.writeVerdicts,
      document,
      this.mode,
      this.onClassContentChanged,
    );
  }

  // ── Active-editor registry ──────────────────────────────────────────────
  // Tracks the focused diagram editor so the diagram-shortcut command,
  // check-model and the library sidebar can drive it.
  private static active: EditorSession | undefined;

  /** Class of the focused diagram editor, or undefined when none is focused. */
  static activeClassName(): string | undefined {
    return DiagramEditorProvider.active?.className();
  }

  /** Push a diagram shortcut to the focused editor's webview; false if none. */
  static runActiveCommand(commandId: DiagramCommandId): boolean {
    const session = DiagramEditorProvider.active;
    if (!session) return false;
    session.send({ type: "runCommand", commandId });
    return true;
  }

  /** Relay a placement gesture from the sidebar; `null` cancels. False if none. */
  static relayPlacement(className: string | null): boolean {
    const session = DiagramEditorProvider.active;
    if (!session) return false;
    session.send(
      className === null
        ? { type: "placementCancel" }
        : { type: "placementStart", className },
    );
    return true;
  }

  /** Relay the armed class's resolved definition to the focused editor. */
  static relayPlacementPreview(className: string, classDef: ClassDef): boolean {
    const session = DiagramEditorProvider.active;
    if (!session) return false;
    session.send({ type: "placementPreview", className, classDef });
    return true;
  }

  // ── Open-session registry ───────────────────────────────────────────────
  // The clipboard is window-wide, so a copy in one editor has to enable paste
  // in every other one — which needs more than the single `active` session.
  private static sessions = new Set<EditorSession>();

  static addSession(session: EditorSession): void {
    DiagramEditorProvider.sessions.add(session);
  }

  static removeSession(session: EditorSession): void {
    DiagramEditorProvider.sessions.delete(session);
  }

  /** Tell every open editor whether the shared clipboard holds anything. */
  static broadcastClipboard(): void {
    const hasClipboard = !diagramClipboard.isEmpty;
    for (const session of DiagramEditorProvider.sessions) {
      session.send({ type: "clipboard", hasClipboard });
    }
  }

  static setActive(session: EditorSession): void {
    DiagramEditorProvider.active = session;
    setInputFocusContext(session.inputFocused);
  }

  static clearActive(session: EditorSession): void {
    if (DiagramEditorProvider.active === session) {
      DiagramEditorProvider.active = undefined;
      setInputFocusContext(false);
    }
  }

  static isActive(session: EditorSession): boolean {
    return DiagramEditorProvider.active === session;
  }
}

interface EditorSession {
  className(): string | undefined;
  send(msg: ExtensionToWebview): void;
  inputFocused: boolean;
}

/**
 * Wire a resolved diagram editor onto its webview panel: resolve the class the
 * `.mo` document stands for, boot the diagram-ui bundle, seed the layout once
 * the webview signals `ready`, and route edit gestures through a write
 * controller. A document whose class can't be resolved renders a static
 * placeholder instead.
 *
 * In `"icon"` mode the class's own icon layout is rendered and its controller
 * honors only icon-appropriate edits (shape draw/edit on the icon layer, and
 * connector placement); all other webview gestures are no-ops.
 */
export function resolveDiagramEditor(
  webviewPanel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  ensureClient: () => Promise<OmcClient>,
  writeVerdicts: WriteVerdicts,
  document: vscode.TextDocument,
  mode: DiagramMode,
  onClassContentChanged?: (className: string) => void,
): void {
  const { webview } = webviewPanel;
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")],
  };

  const gate = createReadyGate(webview);
  let controller: DiagramEditController | undefined;
  let resolvedClassName: string | undefined;
  const session: EditorSession = {
    className: () => resolvedClassName,
    send: (msg) => gate.send(msg),
    inputFocused: false,
  };
  DiagramEditorProvider.addSession(session);

  const sub = webview.onDidReceiveMessage((msg: unknown) => {
    // `postMessage` delivers whatever the webview serialized, and nothing
    // downstream re-checks it.
    if (
      !isGestureMessage(msg, (reason) =>
        log.warn("diagramEditor", `dropped webview message: ${reason}`),
      )
    ) {
      return;
    }
    if (msg.type === "ready") {
      gate.markReady();
      return;
    }
    if (msg.type === "inputFocus") {
      session.inputFocused = msg.focused;
      if (DiagramEditorProvider.isActive(session)) {
        setInputFocusContext(msg.focused);
      }
      return;
    }
    // The controller exists only after the initial layout resolves; the webview
    // sends edits only after `init`, so a missing controller means "not yet".
    void controller?.handle(msg);
  });
  const viewStateSub = webviewPanel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) DiagramEditorProvider.setActive(session);
    else DiagramEditorProvider.clearActive(session);
  });
  webviewPanel.onDidDispose(() => {
    sub.dispose();
    viewStateSub.dispose();
    DiagramEditorProvider.removeSession(session);
    DiagramEditorProvider.clearActive(session);
    controller?.dispose();
  });

  const start = (className: string): void => {
    resolvedClassName = className;
    webview.html = renderDiagramWebviewHtml(webview, extensionUri, className);
    void (async (): Promise<void> => {
      try {
        const client = await ensureClient();
        const layout =
          mode === "icon"
            ? await fetchIconLayout(client, className)
            : await fetchDiagramLayout(client, className);
        // A class that can't be written still renders and answers read
        // actions, but rejects edits. Evaluated after the fetch: fetching
        // resolves a not-yet-loaded class, so a verdict taken earlier (e.g. on
        // a restored tab) would read as writable and strand the editor in edit
        // mode.
        const verdict = await writeVerdicts.forDocument(
          client,
          document,
          className,
          "edit",
        );
        controller = new DiagramEditController(
          {
            client,
            document,
            className,
            gate,
            onClassContentChanged,
            clipboard: diagramClipboard,
            onClipboardChanged: () =>
              DiagramEditorProvider.broadcastClipboard(),
          },
          layout,
          (onForeignChange) => createShadowBuffer(document, onForeignChange),
          defaultScheduler,
          verdict,
          mode,
        );
        gate.send({
          type: "init",
          layout,
          className,
          readOnly: !verdict.ok,
          hasClipboard: !diagramClipboard.isEmpty,
        });
      } catch (err) {
        const detail = (err as Error).message;
        gate.send({ type: "renderError", className, mode, detail });
        log.warn(
          "diagramEditor",
          `Failed to render ${mode} for ${className}: ${detail}`,
        );
      }
    })();
    if (webviewPanel.active) DiagramEditorProvider.setActive(session);
  };

  // The `modelica-source:` scheme encodes the class in its path — resolve it
  // synchronously so the bundle boots without an OMC round-trip.
  const fromScheme = classNameFromDocument(document);
  if (fromScheme !== undefined) {
    start(fromScheme);
    return;
  }

  void (async (): Promise<void> => {
    const className = await classNameFromFile(document, ensureClient);
    if (className === undefined) {
      webview.html = renderPlaceholderPage({
        cspSource: webview.cspSource,
        title: "Modelica diagram",
        message:
          "Open a Modelica class from the library sidebar to see its diagram.",
      });
      return;
    }
    start(className);
  })();
}

interface EditControllerDeps {
  client: OmcClient;
  document: vscode.TextDocument;
  className: string;
  gate: ReadyGate;
  /** Fired after every re-render from a committed change (forward reflect or
   *  reverse sync) — the class's rendered icon may differ now, and the library
   *  sidebar wants to know without polling. Deliberately unfiltered: it also
   *  fires for edits that cannot affect the icon (a diagram-layer move) —
   *  the icon-safe subset is narrow (parameter values, connectors, and
   *  change-class all can alter it) and the eviction+re-render is cheap. */
  onClassContentChanged?: ((className: string) => void) | undefined;
  /** The window-wide clipboard this editor copies into and pastes from. */
  clipboard: DiagramClipboard;
  /** Fired when a copy fills the clipboard, so every open editor enables paste. */
  onClipboardChanged: () => void;
}

/**
 * Per-editor write controller. Forward: a webview edit gesture mutates the OMC
 * AST (the render model), then the class's canonical `listFile` source is
 * reflected into the shadow buffer. Reverse: a foreign buffer change (undo/redo
 * or a manual text edit) is `loadString`ed back into OMC and the layout
 * re-fetched. Both directions re-fetch from OMC and push the layout to the
 * webview; every unit runs through one serialized queue.
 */
export class DiagramEditController {
  private prevLayout: DiagramLayout;
  private readonly shadow: ShadowBuffer;
  private reverseTimer: { cancel(): void } | undefined;
  /**
   * The layout the webview last reported, waiting to be reconciled. One slot,
   * not a list: a report supersedes its predecessor rather than following it.
   */
  private pendingChange: DiagramLayout | null = null;
  /**
   * Set when a settle was suppressed because a report was already queued. The
   * reconcile of that report pays it: a reported edit needs no settle of its
   * own, but one owed to some other path — a paste, a drop, a parameter — is
   * carrying something the webview has no other way to learn.
   */
  private settleOwed = false;
  // True from the moment a reverse sync is enqueued until it resolves —
  // covers the gap between the debounce timer firing and the queued unit's
  // `loadString`/refetch actually completing, which `reverseTimer` alone
  // (cleared the instant the timer fires) does not.
  private reverseSyncInFlight = false;

  // Per-modal submit state, captured when a modal opens and read back when it
  // submits — mirrors the diagram panel's closure state.
  private classParamRefs: Record<string, ClassParameterRef> = {};
  private classParamInitialValues: Record<string, unknown> = {};
  private componentParamRefs: Record<string, ComponentParameterRef> = {};
  private componentParamInitialValues: Record<string, unknown> = {};
  private componentParamComponentName: string | null = null;
  // The shape a shapeProperties modal is editing — captured when it opens, read
  // back on submit.
  private shapeLayerKind: GraphicsLayer | null = null;
  private shapeIndex: number | null = null;
  private shapeKind: string | null = null;
  // The exact shape captured when the modal opened. It stays open across queued
  // units, so an interleaved reverse-sync can re-fetch `prevLayout` with shifted
  // graphics indices; submit requires this identity so an edit can't land on a
  // different shape that now occupies the same index/kind/layer.
  private shapeSnapshot: Shape | null = null;
  private readonly librarySource: LibrarySource;

  // Which layout the fresh render is read from after each edit. Icon mode reads
  // the icon layout so a shape edit targets the `"icon"` graphics layer and a
  // placed connector re-renders; diagram mode reads the full diagram layout.
  private readonly refetch: (
    client: OmcClient,
    className: string,
  ) => Promise<DiagramLayout>;

  constructor(
    private readonly deps: EditControllerDeps,
    initialLayout: DiagramLayout,
    makeShadow: (
      onForeignChange: (document: vscode.TextDocument) => void,
    ) => ShadowBuffer,
    private readonly scheduler: Scheduler = defaultScheduler,
    private readonly verdict: WriteVerdict = { ok: true },
    private readonly mode: DiagramMode = "diagram",
  ) {
    this.prevLayout = initialLayout;
    this.shadow = makeShadow(() => this.onForeignChange());
    this.librarySource = new LibrarySource(deps.client);
    this.refetch = mode === "icon" ? fetchIconLayout : fetchDiagramLayout;
  }

  /**
   * Reject an edit against a class the write verdict refuses: the diagram
   * renders and read actions work, but mutating the class source is refused so
   * we never dirty a buffer that can't be saved.
   */
  private rejectIfReadOnly(): boolean {
    if (this.verdict.ok) return false;
    this.reportError(this.verdict.reason);
    return true;
  }

  private queue: Promise<void> = Promise.resolve();

  /**
   * Serialize work through a one-slot promise chain, so an edit's writes and an
   * undo's `loadString` never interleave on the single OMC socket, and each
   * unit sees the class as the one before it left it. This orders work within
   * one editor; cross-editor socket contention is the client's `SerialQueue`'s
   * job.
   */
  handle(msg: WebviewToExtension): Promise<void> {
    // Every message, so an undo lands in OMC before the next unit reads the class.
    const racing = this.flushRacingReverseSync();
    if (msg.type === "change") {
      if (racing) {
        // The webview computed this against the diagram as it stood before the
        // reverse sync racing it. Reconciling it afterwards would read whatever
        // the sync restored as something the user deleted. Drop it: the sync's
        // own `layout` push resyncs the webview to reconcile against.
        this.reportError(
          "the diagram was resynced from an external change — please retry the edit",
        );
        return this.queue;
      }
      this.pendingChange = msg.layout;
    }
    return this.enqueue(() => this.dispatch(msg));
  }

  dispose(): void {
    this.reverseTimer?.cancel();
    this.shadow.dispose();
  }

  /**
   * A foreign change reverts/edits the buffer out from under OMC. Debounce the
   * burst, then enqueue a reverse sync so OMC's AST is reloaded from the buffer.
   * The self-write guard in the shadow buffer keeps our own reflects out of here.
   */
  private onForeignChange(): void {
    this.reverseTimer?.cancel();
    this.reverseTimer = this.scheduler.schedule(
      () => this.runReverseSyncNow(),
      REVERSE_SYNC_DEBOUNCE_MS,
    );
  }

  /**
   * Flush a pending reverse sync ahead of the caller and report whether one is
   * racing it — either still a timer (not yet enqueued) or already
   * enqueued/running (`loadString`/refetch in flight). Flushing rather than
   * letting the timer fire on its own is what keeps a racing edit from reading
   * a class the sync has not reverted yet, whichever window it lands in.
   */
  private flushRacingReverseSync(): boolean {
    if (this.reverseTimer !== undefined) {
      this.reverseTimer.cancel();
      this.runReverseSyncNow();
      return true;
    }
    return this.reverseSyncInFlight;
  }

  private runReverseSyncNow(): void {
    this.reverseTimer = undefined;
    this.reverseSyncInFlight = true;
    // Same reason the racing `change` above is dropped: this one was reported
    // against the pre-sync diagram too.
    if (this.pendingChange !== null) {
      this.pendingChange = null;
      this.reportError(
        "the diagram was resynced from an external change — please retry the edit",
      );
    }
    void this.enqueue(() =>
      this.reverseSync().finally(() => {
        this.reverseSyncInFlight = false;
      }),
    );
  }

  private enqueue(unit: () => Promise<void>): Promise<void> {
    // A single rejection would sever the chain — every later `.then(unit)` would
    // be skipped and each dropped unit surface as an unhandled rejection. The
    // one place the chain is built is the one place the catch belongs.
    this.queue = this.queue.then(unit).catch((err) => {
      this.reportError(`queued edit failed: ${(err as Error).message}`);
    });
    return this.queue;
  }

  /**
   * Reload the buffer's text into OMC (replacing the class) and re-render from
   * the re-fetched layout. On failure the last-good render is kept — the diagram
   * never goes blank on a bad undo. No reflect back to the buffer: the buffer is
   * already the source of this change, and writing it would fight VSCode's undo.
   */
  private async reverseSync(): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    const { client, className, document } = this.deps;
    try {
      const reload = await reloadBufferIntoOmc(client, document, className);
      if (!reload.ok) {
        this.reportError(reload.message);
        // This sync dropped whatever was reported to make way for it, and then
        // wrote nothing. Without a push the webview goes on showing an edit no
        // class ever took.
        this.publishLayout(this.prevLayout);
        return;
      }
      this.publishLayout(await this.refetch(client, className));
      this.deps.onClassContentChanged?.(className);
    } catch (err) {
      this.reportError(`reverse sync failed: ${(err as Error).message}`);
      this.publishLayout(this.prevLayout);
    }
  }

  private async dispatch(msg: WebviewToExtension): Promise<void> {
    // The icon editor works on the class's own icon annotation, so each
    // gesture's declaration says whether it belongs to that view.
    if (this.mode === "icon" && !iconHonorsGesture(msg)) return;
    switch (msg.type) {
      case "change":
        await this.drainChange();
        return;
      case "addComponent":
        await this.onAddComponent(msg.className, msg.position);
        return;
      case "connectionCreate":
        await this.onConnectionCreate(msg.fromKey, msg.toKey, msg.waypoints);
        return;
      case "actionParameters":
        await this.onActionParameters();
        return;
      case "actionSimulate":
        await this.onActionSimulate();
        return;
      case "actionCheck":
        await this.onActionCheck();
        return;
      case "editComponent":
        await this.onEditComponent(msg.componentName);
        return;
      case "parametersSubmit":
        await this.onParametersSubmit(msg.kind, msg.values, msg.dirty);
        return;
      case "parametersCancel":
        this.onParametersCancel(msg.kind);
        return;
      case "editShape":
        this.onEditShape(msg.key);
        return;
      case "changeClassRequest":
        await this.onChangeClassRequest(msg.componentName, msg.currentClass);
        return;
      case "resetComponentParameters":
        await this.onResetComponentParameters(msg.componentName);
        return;
      case "copySelection":
        await this.onCopySelection(msg.keys);
        return;
      case "paste":
        await this.onPaste();
        return;
      case "ready":
      case "inputFocus":
        // Session-scoped: answered in `resolveDiagramEditor`, which exists
        // before the controller does and outlives every layout it holds.
        return;
      case "selectionChange":
        // Selection is the webview's own state; the host tracks nothing it
        // would have to reconcile.
        return;
      default:
        return assertUnreachable(msg, "WebviewToExtension");
    }
  }

  /**
   * Take whatever the webview last reported and reconcile OMC to it. A newer
   * report supersedes an older one outright — each carries the whole layout, so
   * nothing an earlier one said is missing from it — which is why a burst of
   * gestures collapses to however many the queue could not keep up with.
   */
  private async drainChange(): Promise<void> {
    const next = this.pendingChange;
    // An earlier unit already took it; this one has nothing left to do.
    if (next === null) return;
    this.pendingChange = null;
    await this.applyChange(next);
  }

  /**
   * Reconcile the class to the layout the webview is showing. The base is read
   * from OMC here, so that whatever else has touched the class, the difference
   * between what it holds and what the user is looking at is exactly the set of
   * edits that closes the gap.
   */
  private async applyChange(next: DiagramLayout): Promise<void> {
    if (this.rejectIfReadOnly()) {
      // The webview has already moved what the user dragged. Nothing else will
      // correct it — a reported edit gets no settle of its own — so it would
      // otherwise keep showing an edit the class never took.
      await this.pushCanonicalLayout();
      return;
    }
    const { client, className } = this.deps;
    try {
      const current = await this.refetch(client, className);
      const result = await applyDiagramEdits(client, className, current, next);
      if (result === null) {
        // Nothing to write, but a withheld settle may have left `prevLayout`
        // behind what OMC and the screen both already hold. A null diff only
        // proves the diffed projection matches — an owed settle can be carrying
        // what the diff never compares, a parameter value read into a label or
        // a swapped component's icon — so it is paid from the base in hand.
        this.prevLayout = current;
        if (this.settleOwed) this.publishLayout(current);
        return;
      }
      if (result.failed.length > 0 || result.rolledBack) {
        this.reportError(
          `${result.failed.length} edit(s) failed: ${result.failed.at(0)?.error ?? "unknown"}`,
        );
        // A rolled-back batch left the class byte-identical, so writing the
        // buffer would dirty the document and record an undo step for an edit
        // that did not happen. A partial failure did change it, so it still
        // reflects.
        if (!result.rolledBack) await this.writeBuffer();
        // Now the screen and the class disagree, which is the one thing a
        // push is for. A further report reconciles against whatever the failed
        // batch left behind — the base is read fresh, so it closes the gap from
        // there rather than needing the burst dropped.
        await this.pushCanonicalLayout();
        return;
      }
      await this.writeBuffer();
      if (this.settleOwed) {
        await this.pushCanonicalLayout();
        return;
      }
      // Nothing to tell the webview: it is already showing what the class now
      // holds, and pushing a re-read of it can only arrive late enough to land
      // on a gesture that has moved past it. Drift does not accumulate,
      // because the next reconcile reads its base fresh.
      this.prevLayout = next;
    } catch (err) {
      this.reportError(`applying edits failed: ${(err as Error).message}`);
      await this.pushCanonicalLayout();
    }
  }

  /**
   * Re-read the class and push it, but only once the webview has stopped
   * reporting. Pushing a layout that a queued report has already superseded
   * settles the diagram onto a state the user has moved past, and pushing at
   * all mid-gesture moves what is under the pointer — which the webview guards
   * separately, since a gesture in flight has reported nothing yet.
   */
  private async pushCanonicalLayout(): Promise<void> {
    // The re-fetch is the expensive half, so skip it outright when a report is
    // already waiting; `publishLayout` checks again on the far side of it.
    if (this.pendingChange !== null) {
      this.settleOwed = true;
      return;
    }
    const { client, className } = this.deps;
    this.publishLayout(await this.refetch(client, className));
  }

  /**
   * Adopt `layout` as canonical, and hand it to the webview unless a further
   * report is already queued. That report's settle supersedes this one, and
   * pushing now would put the diagram back on a state the user has moved past.
   */
  private publishLayout(layout: DiagramLayout): void {
    this.prevLayout = layout;
    if (this.pendingChange !== null) {
      this.settleOwed = true;
      return;
    }
    this.settleOwed = false;
    this.deps.gate.send({ type: "layout", layout });
  }

  private async onAddComponent(
    componentClass: string,
    position: { x: number; y: number },
  ): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    if (
      this.mode === "icon" &&
      !(await this.isConnectorClass(componentClass))
    ) {
      return;
    }
    const { client, className } = this.deps;
    const guard = await guardAddComponent(client, componentClass);
    if (guard.kind === "blocked") {
      this.reportError(guard.message);
      return;
    }
    // Fail-open: the guard's own OMC call couldn't verify, so let addComponent
    // proceed and be the authority on whether the write actually succeeds.
    if (guard.kind === "guard-failed") log.warn("diagramEditor", guard.message);
    const componentName = uniqueComponentName(this.prevLayout, componentClass);
    try {
      const { success, diagnostic } = await client.addComponent({
        componentName,
        componentClass,
        intoTypeName: className,
        annotation: placementAt(position),
      });
      if (!success) {
        this.reportError(
          `addComponent ${componentClass} failed: ${diagnostic ?? "OMC rejected it"}`,
        );
        return;
      }
      await this.reflect(await this.refetch(client, className));
    } catch (err) {
      this.reportError(
        `addComponent ${componentClass} failed: ${(err as Error).message}`,
      );
    }
  }

  /** Fill the shared clipboard from the selection. Copying reads the class. */
  private async onCopySelection(keys: string[]): Promise<void> {
    try {
      const items = await captureClipboardItems(
        this.deps.client,
        this.prevLayout,
        keys,
      );
      if (items.length === 0) {
        this.reportError("nothing in the selection can be copied");
        return;
      }
      this.deps.clipboard.write(items);
      this.deps.onClipboardChanged();
    } catch (err) {
      this.reportError(`copy failed: ${(err as Error).message}`);
    }
  }

  /**
   * Paste the clipboard into this class, offset so it doesn't land exactly on
   * the original. Every write happens before the single `reflect`, which is
   * what records the undo step — one paste has to be one undo.
   */
  private async onPaste(): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    const { client, className, clipboard } = this.deps;
    const layer = this.mode === "icon" ? "icon" : "diagram";
    try {
      const items = await this.pasteableItems(clipboard.read());
      if (items.length === 0) return;
      const result = await pasteClipboardItems(
        client,
        className,
        this.prevLayout,
        items,
        layer,
        clipboard.nextOffset(className),
      );
      // A rejection changed nothing, so reflecting would record an undo step
      // for a no-op.
      const failure = result.failed.at(0);
      if (failure !== undefined) {
        this.reportError(failure);
        return;
      }
      if (result.added.length === 0 && result.shapes === 0) return;
      const layout = await this.refetch(client, className);
      await this.reflect(layout);
      // After the reflect: the layout push it sends would otherwise re-key the
      // webview's selection out from under this one.
      this.deps.gate.send({
        type: "select",
        keys: pastedSelectionKeys(layout, result, layer),
      });
    } catch (err) {
      this.reportError(`paste failed: ${(err as Error).message}`);
    }
  }

  /**
   * Narrow the clipboard to what this editor may receive. The icon editor
   * takes shapes and connectors only, the same restriction `onAddComponent`
   * enforces for a drop. The verdict is cached per class so pasting several
   * copies of one connector doesn't re-ask OMC for each.
   */
  private async pasteableItems(
    items: readonly ClipboardEntry[],
  ): Promise<readonly ClipboardEntry[]> {
    if (this.mode !== "icon") return items;
    const verdicts = new Map<string, boolean>();
    const allowed: ClipboardEntry[] = [];
    for (const item of items) {
      // An icon has no connect() equations; a dropped connection is silent
      // rather than an error, since the user copied components, not wires.
      if (item.kind === "connection") continue;
      if (item.kind === "shape") {
        allowed.push(item);
        continue;
      }
      let isConnector = verdicts.get(item.className);
      if (isConnector === undefined) {
        isConnector = await this.isConnectorClass(item.className);
        verdicts.set(item.className, isConnector);
      }
      if (isConnector) allowed.push(item);
    }
    return allowed;
  }

  /**
   * Whether `componentClass` is a connector-restriction class — the only kind
   * the icon editor lets you place. Resolves the restriction via OMC; a
   * non-connector (or a failed resolve) reports a message and returns false so
   * the placement is refused. `endsWith` catches `"expandable connector"`.
   */
  private async isConnectorClass(componentClass: string): Promise<boolean> {
    let restriction: string;
    try {
      ({ restriction } = await this.deps.client.getClassInformation({
        typeName: componentClass,
      }));
    } catch (err) {
      this.reportError(
        `could not resolve the restriction of ${componentClass}: ${(err as Error).message}`,
      );
      return false;
    }
    const kind = restriction.trim();
    if (kind.endsWith("connector")) return true;
    this.reportError(
      `Only connectors can be placed on an icon — ${componentClass} is a ${kind || "non-connector class"}.`,
    );
    return false;
  }

  private async onConnectionCreate(
    fromKey: string,
    toKey: string,
    waypoints: ReadonlyArray<readonly [number, number]>,
  ): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    const { client, className } = this.deps;
    const from = keyToCref(this.prevLayout, fromKey);
    const to = keyToCref(this.prevLayout, toKey);
    if (from === null || to === null) {
      this.reportError(`connection endpoints not found (${fromKey}, ${toKey})`);
      return;
    }
    try {
      const { success, diagnostic } = await client.addConnection({
        from,
        to,
        typeName: className,
        annotation: lineAnnotation(waypoints),
      });
      if (!success) {
        this.reportError(
          `addConnection failed: ${diagnostic ?? "OMC rejected it"}`,
        );
        return;
      }
      await this.reflect(await this.refetch(client, className));
    } catch (err) {
      this.reportError(`addConnection failed: ${(err as Error).message}`);
    }
  }

  private async onActionParameters(): Promise<void> {
    const { client, className, gate } = this.deps;
    try {
      const instance = await fetchModelInstance(client, className);
      const unitTable = await buildClassUnitTable(client, instance);
      const form = buildClassParameterForm(instance, unitTable);
      if (!form) {
        void vscode.window.showInformationMessage(
          `Modelica: ${className} has no editable scalar parameters.`,
        );
        return;
      }
      this.classParamRefs = form.refs;
      this.classParamInitialValues = form.values;
      gate.send({
        type: "parametersOpen",
        kind: "classParams",
        model: form.model,
        title: `Parameters: ${className}`,
        submitLabel: "Apply",
      });
    } catch (err) {
      this.reportError(
        `could not open parameters for ${className}: ${(err as Error).message}`,
      );
    }
  }

  private async onEditComponent(componentName: string): Promise<void> {
    const { client, className, gate } = this.deps;
    try {
      const instance = await fetchModelInstance(client, className);
      const component = findSubComponent(instance, componentName);
      if (!component) {
        void vscode.window.showInformationMessage(
          `Modelica: component "${componentName}" not found on ${className}.`,
        );
        return;
      }
      const unitTable = await buildComponentUnitTable(client, component);
      const form = buildComponentParameterForm(component, unitTable);
      if (!form) {
        void vscode.window.showInformationMessage(
          `Modelica: ${componentName} has no editable scalar parameters.`,
        );
        return;
      }
      this.componentParamRefs = form.refs;
      this.componentParamInitialValues = form.values;
      this.componentParamComponentName = form.componentName;
      gate.send({
        type: "parametersOpen",
        kind: "componentParams",
        model: form.model,
        title: `Parameters: ${componentName}${componentTypeSuffix(component)}`,
        submitLabel: "Apply",
        crefPrefix: componentName,
      });
    } catch (err) {
      this.reportError(
        `could not open parameters for ${componentName}: ${(err as Error).message}`,
      );
    }
  }

  private async onParametersSubmit(
    kind: ParameterFormKind,
    values: Record<string, unknown>,
    dirty: readonly string[],
  ): Promise<void> {
    try {
      await this.applyParameterSubmit(kind, values, dirty);
    } catch (err) {
      this.reportError(`applying parameters failed: ${(err as Error).message}`);
    } finally {
      this.deps.gate.send({ type: "parametersClose" });
    }
  }

  private async applyParameterSubmit(
    kind: ParameterFormKind,
    values: Record<string, unknown>,
    dirty: readonly string[],
  ): Promise<void> {
    const { client, className } = this.deps;
    switch (kind) {
      case "simulate":
        // Simulate runs the model and emits a result file; it does not change
        // the class source, so there is nothing to reflect to the buffer, and
        // it stays allowed on a read-only class.
        await runSimulate(client, className, values);
        return;
      case "classParams":
        if (this.rejectIfReadOnly()) return;
        await applyClassParameterEdits(
          client,
          className,
          this.classParamRefs,
          this.classParamInitialValues,
          values,
        );
        await this.reflect(await this.refetch(client, className));
        return;
      case "componentParams": {
        if (this.rejectIfReadOnly()) return;
        const componentName = this.componentParamComponentName;
        if (componentName === null) return;
        await applyComponentParameterEdits(
          client,
          className,
          componentName,
          this.componentParamRefs,
          this.componentParamInitialValues,
          values,
        );
        await this.reflect(await this.refetch(client, className));
        return;
      }
      case "shapeProperties":
        if (this.rejectIfReadOnly()) return;
        await this.applyShapePropertiesSubmit(values, dirty);
        return;
      default:
        return assertUnreachable(kind, "ParameterFormKind");
    }
  }

  private async onActionSimulate(): Promise<void> {
    const { client, className, gate } = this.deps;
    try {
      const model = produceSimulationModel({
        className,
        options: await fetchSimulationOptions(client, className),
      });
      gate.send({
        type: "parametersOpen",
        kind: "simulate",
        model,
        title: `Simulate ${className}`,
        submitLabel: "Run",
      });
    } catch (err) {
      this.reportError(
        `could not open the simulate panel for ${className}: ${(err as Error).message}`,
      );
    }
  }

  private async onActionCheck(): Promise<void> {
    // Route to the existing `modelica.checkModel` command, naming the class
    // (a custom editor isn't a text editor, so the command's active-target
    // fallback can't find it). Check reports diagnostics — no source change.
    try {
      await vscode.commands.executeCommand(
        "modelica.checkModel",
        this.deps.className,
      );
    } catch (err) {
      this.reportError(`check model failed: ${(err as Error).message}`);
    }
  }

  private async applyShapePropertiesSubmit(
    values: Record<string, unknown>,
    dirty: readonly string[],
  ): Promise<void> {
    const { client, className } = this.deps;
    if (this.shapeLayerKind === null || this.shapeIndex === null) return;
    const layer = this.shapeLayerKind;
    const index = this.shapeIndex;
    const found = lookupHostShape(
      this.prevLayout,
      index,
      this.shapeKind ?? undefined,
    );
    if (
      found === null ||
      found.layerKind !== layer ||
      JSON.stringify(found.shape) !== JSON.stringify(this.shapeSnapshot)
    ) {
      this.reportError(
        "shape changed while the properties modal was open — edit not applied",
      );
      return;
    }
    const edit: LayoutEdit = {
      kind: "graphicsModified",
      layer,
      index,
      shape: applyShapeProperties(found.shape, values, new Set(dirty)),
    };
    const result = await applyEdits(client, className, [edit], undefined, {
      snapshot: true,
    });
    if (result.failed.length > 0) {
      this.reportError(
        `shape edit failed: ${result.failed.at(0)?.error ?? "unknown"}`,
      );
    }
    await this.reflect(await this.refetch(client, className));
  }

  private onParametersCancel(kind: ParameterFormKind): void {
    switch (kind) {
      case "componentParams":
        this.clearComponentParamState();
        return;
      case "shapeProperties":
        this.clearShapeState();
        return;
      case "classParams":
      case "simulate":
        // Neither captures state the modal has to hand back.
        return;
      default:
        return assertUnreachable(kind, "ParameterFormKind");
    }
  }

  /**
   * Open the shape properties modal, capturing the shape it was opened on so
   * the submit can refuse to land on a different one. Driven by a double
   * click: opening on selection interrupts every pick of a shape, including
   * the one a drag starts with.
   */
  private onEditShape(key: string): void {
    const parsed = parseKey(key);
    if (parsed?.kind !== "shape") return;
    if (!Number.isInteger(parsed.index)) return;
    const found = lookupHostShape(
      this.prevLayout,
      parsed.index,
      parsed.shapeKind,
    );
    if (found === null) return;
    this.shapeLayerKind = found.layerKind;
    this.shapeIndex = parsed.index;
    this.shapeKind = parsed.shapeKind;
    this.shapeSnapshot = found.shape;
    this.deps.gate.send({
      type: "parametersOpen",
      kind: "shapeProperties",
      model: buildShapePropertiesForm(found.shape),
      title: `Shape: ${found.shape.kind}`,
      submitLabel: "Apply",
    });
  }

  private async onChangeClassRequest(
    componentName: string,
    currentClass: string,
  ): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    const { client, className } = this.deps;
    try {
      const newClass = await pickClassToSwap(
        this.librarySource,
        componentName,
        currentClass,
        client,
        this.prevLayout,
      );
      if (!newClass || newClass.trim() === currentClass.trim()) return;
      await client.getErrorString();
      const { success } = await client.setElementType({
        typeName: `${className}.${componentName}`,
        newTypeName: newClass.trim(),
      });
      if (!success) {
        const { errorString } = await client.getErrorString();
        this.reportError(
          `setElementType ${componentName} failed: ${errorString.trim() || "OMC returned success=false"}`,
        );
        return;
      }
      await this.reflect(await this.refetch(client, className));
    } catch (err) {
      this.reportError(
        `setElementType ${componentName} failed: ${(err as Error).message}`,
      );
    }
  }

  private clearShapeState(): void {
    this.shapeLayerKind = null;
    this.shapeIndex = null;
    this.shapeKind = null;
    this.shapeSnapshot = null;
  }

  private async onResetComponentParameters(
    componentName: string,
  ): Promise<void> {
    if (this.rejectIfReadOnly()) return;
    const { client, className, gate } = this.deps;
    try {
      // Bulk-clear the sub-component's modifiers (keepRedeclares keeps any
      // substituted type), then re-render + re-open the modal with the exposed
      // type defaults.
      const ok = await resetComponentParameters(
        client,
        className,
        componentName,
      );
      if (!ok) return;
      const instance = await fetchModelInstance(client, className);
      // A flaky layout rebuild must not swallow the modal re-open: the reset
      // already committed, so re-open with the fresh instance regardless.
      try {
        await this.reflect(
          await layoutFromInstance(client, className, instance),
        );
      } catch (err) {
        this.reportError(
          `reset ${componentName} refetch failed: ${(err as Error).message}`,
        );
      }
      const component = findSubComponent(instance, componentName);
      if (!component) {
        this.clearComponentParamState();
        gate.send({ type: "parametersClose" });
        return;
      }
      const unitTable = await buildComponentUnitTable(client, component);
      const form = buildComponentParameterForm(component, unitTable);
      if (!form) {
        this.clearComponentParamState();
        gate.send({ type: "parametersClose" });
        return;
      }
      this.componentParamRefs = form.refs;
      this.componentParamInitialValues = form.values;
      this.componentParamComponentName = form.componentName;
      gate.send({
        type: "parametersOpen",
        kind: "componentParams",
        model: form.model,
        title: `Parameters: ${componentName}${componentTypeSuffix(component)}`,
        submitLabel: "Apply",
        crefPrefix: componentName,
      });
    } catch (err) {
      this.reportError(
        `reset ${componentName} failed: ${(err as Error).message}`,
      );
    }
  }

  private clearComponentParamState(): void {
    this.componentParamRefs = {};
    this.componentParamInitialValues = {};
    this.componentParamComponentName = null;
  }

  /**
   * Push the re-fetched layout to the webview and reflect the class's canonical
   * OMC source into the shadow buffer, recording one undo step and flipping the
   * document dirty.
   */
  private async reflect(layout: DiagramLayout): Promise<void> {
    this.publishLayout(layout);
    await this.writeBuffer();
  }

  /** Reflect the class's canonical OMC source into the shadow buffer,
   *  recording one undo step and flipping the document dirty. */
  private async writeBuffer(): Promise<void> {
    const { contents } = await this.deps.client.listFile({
      typeName: this.deps.className,
    });
    // A built-in with no listable source returns empty; writing that would wipe
    // the buffer.
    if (contents.length > 0) await this.shadow.write(contents);
    // Tied to the write rather than to the push: the rendered icon is stale
    // from the moment the class changes, whether or not a settle goes out.
    this.deps.onClassContentChanged?.(this.deps.className);
  }

  private reportError(message: string): void {
    this.deps.gate.send({ type: "error", message });
    log.warn("diagramEditor", message);
    // The webview has nowhere to show this, and an edit that silently does not
    // land reads as the diagram losing the user's work for no reason.
    void vscode.window.showErrorMessage(`Diagram: ${message}`);
  }
}

/** The ` (TypeName)` suffix a component modal's title carries, or "". */
function componentTypeSuffix(component: ComponentElement): string {
  const type = component.type;
  const typeName =
    typeof type === "object" && type !== null ? type.name : String(type ?? "");
  return typeName ? ` (${typeName})` : "";
}

/**
 * Resolve the top-level class of an on-disk `file:` `.mo` via OMC `parseFile`,
 * which reads the file WITHOUT loading it into the symbol table. Returns the
 * first declared class, or `undefined` when the document isn't a `file:` `.mo`,
 * parsing fails, or no class is declared.
 *
 * Resolving against the on-disk file only picks a class to render; it never
 * creates a second editable buffer, so it is independent of the `file:` edit
 * policy the write path needs.
 */
async function classNameFromFile(
  document: vscode.TextDocument,
  ensureClient: () => Promise<OmcClient>,
): Promise<string | undefined> {
  const { uri } = document;
  if (uri.scheme !== "file" || !uri.path.endsWith(".mo")) return undefined;
  try {
    const client = await ensureClient();
    const { classNames } = await client.parseFile({ fileName: uri.fsPath });
    const first = classNames.at(0);
    if (first === undefined) return undefined;
    if (classNames.length > 1) {
      log.info(
        "diagramEditor",
        `${uri.fsPath} declares ${classNames.length} top-level classes; rendering ${first}`,
      );
    }
    return first;
  } catch (err) {
    log.warn(
      "diagramEditor",
      `parseFile failed for ${uri.fsPath}: ${(err as Error).message}`,
    );
    return undefined;
  }
}
