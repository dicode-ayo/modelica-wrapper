import * as vscode from "vscode";

import type {
  ComponentElement,
  DiagramLayout,
  OmcClient,
} from "@dicode/omc-client";

import { log } from "../logger.js";
import { qualifiedNameFromUri } from "../source-provider.js";
import type { WebviewToExtension } from "../webview/protocol.js";
import { createReadyGate, type ReadyGate } from "../webview/ready-gate.js";

import { applyEdits } from "./apply-edits.js";
import {
  lineAnnotation,
  type GraphicsLayer,
  type LayoutEdit,
} from "./diff-layout.js";
import { renderDiagramWebviewHtml } from "./diagram-webview-html.js";
import { isShapeKey, parseEntityKey } from "./entity-key.js";
import { LibrarySource } from "./library-source.js";
import {
  applyClassParameterEdits,
  applyComponentParameterEdits,
  applyDiagramEdits,
  buildClassUnitTable,
  buildComponentUnitTable,
  fetchDiagramLayout,
  fetchModelInstance,
  keyToCref,
  layoutFromInstance,
  pickClassToSwap,
  placementAt,
  resetComponentParameters,
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

export const DIAGRAM_VIEW_TYPE = "modelica.diagram";

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
 * renders a class's diagram from OMC and applies graphical edits. Edits mutate
 * the OMC AST (the render model), and the class's canonical source is reflected
 * back into the document through a shadow buffer so VSCode tracks dirty state
 * and undo. A foreign buffer change (undo/redo or a manual text edit) is
 * `loadString`ed back into OMC and the layout re-fetched; save flushes the
 * reflected buffer through its document provider.
 */
export class DiagramEditorProvider implements vscode.CustomTextEditorProvider {
  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ensureClient: () => Promise<OmcClient>,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    ensureClient: () => Promise<OmcClient>,
  ): vscode.Disposable {
    const provider = new DiagramEditorProvider(
      context.extensionUri,
      ensureClient,
    );
    return vscode.window.registerCustomEditorProvider(
      DIAGRAM_VIEW_TYPE,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
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
      document,
    );
  }
}

/**
 * Wire a resolved diagram editor onto its webview panel: resolve the class the
 * `.mo` document stands for, boot the diagram-ui bundle, seed the layout once
 * the webview signals `ready`, and route edit gestures through a write
 * controller. A document whose class can't be resolved renders a static
 * placeholder instead.
 */
export function resolveDiagramEditor(
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

  const gate = createReadyGate(webview);
  let controller: DiagramEditController | undefined;

  const sub = webview.onDidReceiveMessage((msg: WebviewToExtension) => {
    if (msg.type === "ready") {
      gate.markReady();
      return;
    }
    // The controller exists only after the initial layout resolves; the webview
    // sends edits only after `init`, so a missing controller means "not yet".
    void controller?.handle(msg);
  });
  webviewPanel.onDidDispose(() => {
    sub.dispose();
    controller?.dispose();
  });

  const start = (className: string): void => {
    webview.html = renderDiagramWebviewHtml(webview, extensionUri, className);
    void (async (): Promise<void> => {
      try {
        const client = await ensureClient();
        const layout = await fetchDiagramLayout(client, className);
        controller = new DiagramEditController(
          { client, document, className, gate },
          layout,
          (onForeignChange) => createShadowBuffer(document, onForeignChange),
        );
        gate.send({ type: "init", layout, className });
      } catch (err) {
        const message = `Failed to render diagram for ${className}: ${(err as Error).message}`;
        gate.send({ type: "error", message });
        log.warn("diagramEditor", message);
      }
    })();
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
      webview.html = renderPlaceholderHtml(webview.cspSource);
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

// Coalesce a burst of foreign changes (holding undo/redo, or typing in the
// text view) into one reverse sync once the buffer settles.
const REVERSE_SYNC_DEBOUNCE_MS = 150;

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

  // Per-modal submit state, captured when a parameter modal opens and read
  // back when it submits — mirrors the diagram panel's closure state.
  private classParamRefs: Record<string, ClassParameterRef> = {};
  private classParamInitialValues: Record<string, unknown> = {};
  private componentParamRefs: Record<string, ComponentParameterRef> = {};
  private componentParamInitialValues: Record<string, unknown> = {};
  private componentParamComponentName: string | null = null;
  // Drops a double-clicked "Reset to defaults" second invocation while the
  // first is still re-fetching and re-opening.
  private resetInFlight = false;
  // The shape a shapeProperties modal is editing — captured on selection, read
  // back on submit.
  private shapeLayerKind: GraphicsLayer | null = null;
  private shapeIndex: number | null = null;
  private shapeKind: string | null = null;
  private readonly librarySource: LibrarySource;

  constructor(
    private readonly deps: EditControllerDeps,
    initialLayout: DiagramLayout,
    makeShadow: (
      onForeignChange: (document: vscode.TextDocument) => void,
    ) => ShadowBuffer,
    private readonly scheduler: Scheduler = defaultScheduler,
  ) {
    this.prevLayout = initialLayout;
    this.shadow = makeShadow(() => this.onForeignChange());
    this.librarySource = new LibrarySource(deps.client);
  }

  private queue: Promise<void> = Promise.resolve();

  /**
   * Serialize edits through a one-slot promise chain so each unit's full
   * apply→reflect (or reverse sync) — which advances `prevLayout` — completes
   * before the next one diffs. Otherwise concurrent edits would diff against a
   * stale layout, and an undo's `loadString` racing an in-flight edit's writes
   * on the single OMC socket would corrupt state. This orders work within one
   * editor; cross-editor socket contention is the client's `SerialQueue`'s job.
   */
  handle(msg: WebviewToExtension): Promise<void> {
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
    this.reverseTimer = this.scheduler.schedule(() => {
      this.reverseTimer = undefined;
      void this.enqueue(() => this.reverseSync());
    }, REVERSE_SYNC_DEBOUNCE_MS);
  }

  private enqueue(unit: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(unit);
    return this.queue;
  }

  /**
   * Reload the buffer's text into OMC (replacing the class) and re-render from
   * the re-fetched layout. On failure the last-good render is kept — the diagram
   * never goes blank on a bad undo. No reflect back to the buffer: the buffer is
   * already the source of this change, and writing it would fight VSCode's undo.
   */
  private async reverseSync(): Promise<void> {
    const { client, className, document } = this.deps;
    try {
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
      const layout = await fetchDiagramLayout(client, className);
      this.prevLayout = layout;
      this.deps.gate.send({ type: "layout", layout });
    } catch (err) {
      this.reportError(`reverse sync failed: ${(err as Error).message}`);
    }
  }

  private async dispatch(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "change":
        await this.onChange(msg.layout);
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
      case "editComponent":
        await this.onEditComponent(msg.componentName);
        return;
      case "parametersSubmit":
        await this.onParametersSubmit(msg.kind, msg.values);
        return;
      case "parametersCancel":
        this.onParametersCancel(msg.kind);
        return;
      case "selectionChange":
        this.onSelectionChange(msg.keys);
        return;
      case "changeClassRequest":
        await this.onChangeClassRequest(msg.componentName, msg.currentClass);
        return;
      case "resetComponentParameters":
        await this.onResetComponentParameters(msg.componentName);
        return;
      default:
        // Simulate / check / shape / change-class messages are not handled here.
        return;
    }
  }

  private async onChange(next: DiagramLayout): Promise<void> {
    const { client, className } = this.deps;
    try {
      const result = await applyDiagramEdits(
        client,
        className,
        this.prevLayout,
        next,
      );
      if (result === null) return;
      if (result.failed.length > 0) {
        this.reportError(
          `${result.failed.length} edit(s) failed: ${result.failed.at(0)?.error ?? "unknown"}`,
        );
      }
      await this.reflect(result.layout);
    } catch (err) {
      this.reportError(`applying edits failed: ${(err as Error).message}`);
    }
  }

  private async onAddComponent(
    componentClass: string,
    position: { x: number; y: number },
  ): Promise<void> {
    const { client, className } = this.deps;
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
      await this.reflect(await fetchDiagramLayout(client, className));
    } catch (err) {
      this.reportError(
        `addComponent ${componentClass} failed: ${(err as Error).message}`,
      );
    }
  }

  private async onConnectionCreate(
    fromKey: string,
    toKey: string,
    waypoints: ReadonlyArray<readonly [number, number]>,
  ): Promise<void> {
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
      await this.reflect(await fetchDiagramLayout(client, className));
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
    kind: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    const { client, className, gate } = this.deps;
    try {
      if (kind === "classParams") {
        await applyClassParameterEdits(
          client,
          className,
          this.classParamRefs,
          this.classParamInitialValues,
          values,
        );
        await this.reflect(await fetchDiagramLayout(client, className));
      } else if (kind === "componentParams") {
        if (this.componentParamComponentName !== null) {
          await applyComponentParameterEdits(
            client,
            className,
            this.componentParamComponentName,
            this.componentParamRefs,
            this.componentParamInitialValues,
            values,
          );
          await this.reflect(await fetchDiagramLayout(client, className));
        }
      } else if (kind === "shapeProperties") {
        await this.applyShapePropertiesSubmit(values);
      }
    } catch (err) {
      this.reportError(`applying parameters failed: ${(err as Error).message}`);
    } finally {
      gate.send({ type: "parametersClose" });
    }
  }

  private async applyShapePropertiesSubmit(
    values: Record<string, unknown>,
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
    if (found === null || found.layerKind !== layer) return;
    const edit: LayoutEdit = {
      kind: "graphicsModified",
      layer,
      index,
      shape: applyShapeProperties(found.shape, values),
    };
    const result = await applyEdits(client, className, [edit], undefined, {
      snapshot: true,
    });
    if (result.failed.length > 0) {
      this.reportError(
        `shape edit failed: ${result.failed.at(0)?.error ?? "unknown"}`,
      );
    }
    await this.reflect(await fetchDiagramLayout(client, className));
  }

  private onParametersCancel(kind: string): void {
    if (kind === "componentParams") this.clearComponentParamState();
    if (kind === "shapeProperties") this.clearShapeState();
  }

  private onSelectionChange(keys: string[]): void {
    if (keys.length !== 1) return;
    const key = keys[0];
    if (key === undefined) return;
    const parsed = parseEntityKey(key);
    if (parsed === null || !isShapeKey(parsed)) return;
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
      await this.reflect(await fetchDiagramLayout(client, className));
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
  }

  private async onResetComponentParameters(
    componentName: string,
  ): Promise<void> {
    if (this.resetInFlight) return;
    this.resetInFlight = true;
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
      await this.reflect(await layoutFromInstance(client, className, instance));
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
    } finally {
      this.resetInFlight = false;
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
    this.prevLayout = layout;
    this.deps.gate.send({ type: "layout", layout });
    const { contents } = await this.deps.client.listFile({
      typeName: this.deps.className,
    });
    // A built-in with no listable source returns empty; writing that would wipe
    // the buffer.
    if (contents.length > 0) await this.shadow.write(contents);
  }

  private reportError(message: string): void {
    this.deps.gate.send({ type: "error", message });
    log.warn("diagramEditor", message);
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
    <title>Modelica diagram</title>
    <style>
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        font-family: var(--vscode-font-family);
        color: var(--vscode-descriptionForeground);
      }
      p { max-width: 32rem; padding: 1rem; text-align: center; }
    </style>
  </head>
  <body>
    <p>Open a Modelica class from the library sidebar to see its diagram.</p>
  </body>
</html>`;
}
