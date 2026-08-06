/**
 * The documentation editor renders and edits a class's `Documentation(info=…)`.
 * These pin the contracts the plumbing rests on: the `info` is seeded to the
 * webview only after its `ready` handshake; a failed OMC read surfaces as an
 * `error`; an unresolved class renders a placeholder without reading OMC; the
 * focused class is tracked for the switcher; and — the load-bearing invariant —
 * an edit writes the new `info` through OMC and reflects the canonical source
 * into the buffer, while an MSL source is refused. Preserving `revisions` and
 * `infoHeader` on write is `setFullDocumentationAnnotation`'s own contract,
 * pinned in omc-client's tests, not the controller's.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { ModelInstanceSchema, type OmcClient } from "@dicode/omc-client";

import type { DocExtensionToWebview } from "../webview/documentation-protocol.js";
import type { ReadyGate } from "../webview/ready-gate.js";
import { type Scheduler } from "../diagram/buffer-sync.js";

import {
  DocumentationEditController,
  DocumentationEditorProvider,
  resolveDocumentationEditor,
  type DocumentationClient,
} from "./documentation-editor-provider.js";
import { WriteVerdicts } from "../write-verdict.js";

const EXT_URI = vscode.Uri.file("/ext");

const MODELICA_PATH = "/home/u/.openmodelica/libraries";

/** The OMC calls a write verdict is derived from. */
function verdictWrappers(systemLib: boolean) {
  return {
    getSourceFile: vi.fn(() =>
      Promise.resolve({
        fileName: systemLib
          ? `${MODELICA_PATH}/Modelica/Blocks/package.mo`
          : "/ws/Pkg/M.mo",
      }),
    ),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: MODELICA_PATH }),
    ),
    getClassInformation: vi.fn(() => Promise.resolve({ fileReadOnly: false })),
  };
}

// ── resolve path ───────────────────────────────────────────────────────────

interface FakeWebview {
  options: unknown;
  cspSource: string;
  html: string;
  asWebviewUri: (u: vscode.Uri) => vscode.Uri;
  postMessage: (m: DocExtensionToWebview) => Promise<boolean>;
  onDidReceiveMessage: (l: (m: { type: "ready" }) => void) => {
    dispose(): void;
  };
}

function makePanel(active = false): {
  panel: vscode.WebviewPanel;
  webview: FakeWebview;
  posted: DocExtensionToWebview[];
  fireReady: () => void;
  fireViewState: (isActive: boolean) => void;
  fireDispose: () => void;
} {
  const posted: DocExtensionToWebview[] = [];
  let listener: ((m: { type: "ready" }) => void) | undefined;
  let viewStateListener:
    | ((e: { webviewPanel: { active: boolean } }) => void)
    | undefined;
  let disposeListener: (() => void) | undefined;
  const webview: FakeWebview = {
    options: undefined,
    cspSource: "vscode-webview:",
    html: "",
    asWebviewUri: (u) => u,
    postMessage: (m) => {
      posted.push(m);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (l) => {
      listener = l;
      return { dispose: () => {} };
    },
  };
  const panel = {
    webview,
    active,
    onDidDispose: (l: () => void) => {
      disposeListener = l;
      return { dispose: () => {} };
    },
    onDidChangeViewState: (
      l: (e: { webviewPanel: { active: boolean } }) => void,
    ) => {
      viewStateListener = l;
      return { dispose: () => {} };
    },
  };
  return {
    panel: panel as unknown as vscode.WebviewPanel,
    webview,
    posted,
    fireReady: () => listener?.({ type: "ready" }),
    fireViewState: (isActive) => {
      panel.active = isActive;
      viewStateListener?.({ webviewPanel: { active: isActive } });
    },
    fireDispose: () => disposeListener?.(),
  };
}

function makeResolveClient(anno: {
  info: string;
  revision?: string;
  infoHeader?: string;
  restriction?: string;
  systemLib?: boolean;
}): OmcClient {
  return {
    ...verdictWrappers(anno.systemLib ?? false),
    getDocumentationAnnotation: vi.fn(() =>
      Promise.resolve({
        info: anno.info,
        revision: anno.revision ?? "",
        infoHeader: anno.infoHeader ?? "",
      }),
    ),
    getClassRestriction: vi.fn(() =>
      Promise.resolve({ restriction: anno.restriction ?? "block" }),
    ),
    getModelInstance: vi.fn(() => Promise.resolve({ instance: PID_INSTANCE })),
  } as unknown as OmcClient;
}

/** A minimal PID-like instance: one parameter, one connector, one extends. */
const PID_INSTANCE = ModelInstanceSchema.parse({
  name: "Modelica.Blocks.Continuous.PID",
  restriction: "block",
  elements: [
    {
      $kind: "extends",
      baseClass: {
        name: "Modelica.Blocks.Interfaces.SISO",
        restriction: "block",
        comment: "Single Input Single Output",
      },
    },
    {
      $kind: "component",
      name: "k",
      type: "Real",
      value: { binding: 1 },
      prefixes: { variability: "parameter" },
      comment: "Gain",
    },
    {
      $kind: "component",
      name: "u",
      type: {
        name: "Modelica.Blocks.Interfaces.RealInput",
        restriction: "connector",
        elements: [],
      },
      prefixes: { direction: "input" },
    },
  ],
});

function docFor(uri: vscode.Uri): vscode.TextDocument {
  return { uri } as unknown as vscode.TextDocument;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

const PID_DOC = docFor(
  vscode.Uri.parse("modelica-source:/Modelica.Blocks.Continuous.PID.mo"),
);

describe("resolveDocumentationEditor", () => {
  it("queues the info until ready, then posts a single writable doc", async () => {
    const { panel, webview, posted, fireReady } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.resolve(makeResolveClient({ info: "<html><p>PID</p></html>" })),
    );

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      PID_DOC,
    );
    expect(webview.html).toContain("om-documentation-root");

    await flush();
    expect(posted).toEqual([]); // held back until ready

    fireReady();
    await flush();
    // The HTML paints first; the interface follows in its own message.
    expect(posted.map((m) => m.type)).toEqual(["doc", "interface"]);
    const doc = posted[0];
    expect(doc?.type).toBe("doc");
    if (doc?.type === "doc") {
      expect(doc.className).toBe("Modelica.Blocks.Continuous.PID");
      expect(doc.info).toBe("<html><p>PID</p></html>");
      expect(doc.readOnly).toBe(false);
    }
    const iface = posted[1];
    expect(iface?.type).toBe("interface");
    if (iface?.type === "interface") {
      expect(iface.interface.parameters).toEqual([
        { name: "k", description: "Gain", value: "1", group: "Parameters" },
      ]);
      expect(iface.interface.connectors).toEqual([
        { name: "u", typeName: "RealInput", direction: "input" },
      ]);
      expect(iface.interface.extendsTree.map((n) => n.name)).toEqual([
        "Modelica.Blocks.Interfaces.SISO",
      ]);
    }
  });

  it.each(["package", "type", "function"])(
    "never instantiates a %s for the interface",
    async (restriction) => {
      // getModelInstance never returns for the builtins and costs seconds on
      // deep hierarchies; the restriction gate must keep it off the serialized
      // OMC socket entirely, not merely tolerate its failure.
      const { panel, posted, fireReady } = makePanel();
      const client = makeResolveClient({
        info: "<html><p>pkg</p></html>",
        restriction,
      });
      const ensureClient = vi.fn(() => Promise.resolve(client));

      resolveDocumentationEditor(
        panel,
        EXT_URI,
        ensureClient,
        new WriteVerdicts(),
        PID_DOC,
      );
      await flush();
      fireReady();
      await flush();

      expect(posted.map((m) => m.type)).toEqual(["doc"]);
      expect(client.getModelInstance).not.toHaveBeenCalled();
    },
  );

  it("does not mark a class carrying an infoHeader read-only", async () => {
    const { panel, posted, fireReady } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.resolve(
        makeResolveClient({
          info: "<html><p>x</p></html>",
          infoHeader: "<html><p>header</p></html>",
        }),
      ),
    );

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      PID_DOC,
    );
    await flush();
    fireReady();
    await flush();

    const msg = posted.find((m) => m.type === "doc");
    expect(msg?.type === "doc" && msg.readOnly).toBe(false);
  });

  it("marks an installed-library source read-only", async () => {
    const { panel, posted, fireReady } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.resolve(
        makeResolveClient({ info: "<html><p>x</p></html>", systemLib: true }),
      ),
    );

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      PID_DOC,
    );
    await flush();
    fireReady();
    await flush();

    const msg = posted.find((m) => m.type === "doc");
    expect(msg?.type === "doc" && msg.readOnly).toBe(true);
  });

  it("evaluates readOnly after getDocumentationAnnotation resolves the class", async () => {
    const { panel, posted, fireReady } = makePanel();
    // Read-only becomes visible only once the fetch has resolved the class: an
    // unresolved class has no source file to classify. Restriction "package"
    // also confirms this no longer depends on fetchInterface's
    // getModelInstance, which packages never call.
    let fetched = false;
    const client = {
      getDocumentationAnnotation: vi.fn(() => {
        fetched = true;
        return Promise.resolve({ info: "<html><p>x</p></html>" });
      }),
      getClassRestriction: vi.fn(() =>
        Promise.resolve({ restriction: "package" }),
      ),
      getSourceFile: vi.fn(() =>
        Promise.resolve({
          fileName: fetched ? `${MODELICA_PATH}/Modelica/package.mo` : "",
        }),
      ),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: MODELICA_PATH }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileReadOnly: false }),
      ),
    } as unknown as OmcClient;
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      PID_DOC,
    );
    await flush();
    fireReady();
    await flush();

    const msg = posted.find((m) => m.type === "doc");
    expect(msg?.type === "doc" && msg.readOnly).toBe(true);
  });

  it("posts an error, not a doc, when the OMC read throws", async () => {
    const { panel, posted, fireReady } = makePanel();
    const client = {
      getDocumentationAnnotation: vi.fn(() =>
        Promise.reject(new Error("OMC down")),
      ),
    } as unknown as OmcClient;
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      PID_DOC,
    );
    await flush();
    fireReady();
    await flush();

    expect(posted.some((m) => m.type === "error")).toBe(true);
    expect(posted.some((m) => m.type === "doc")).toBe(false);
  });

  it("tracks the focused class for the switcher, and clears it on blur/dispose", () => {
    const { panel, fireViewState, fireDispose } = makePanel(true);
    const ensureClient = vi.fn(() =>
      Promise.resolve(makeResolveClient({ info: "" })),
    );

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      PID_DOC,
    );
    expect(DocumentationEditorProvider.activeClassName()).toBe(
      "Modelica.Blocks.Continuous.PID",
    );

    fireViewState(false);
    expect(DocumentationEditorProvider.activeClassName()).toBeUndefined();

    fireViewState(true);
    expect(DocumentationEditorProvider.activeClassName()).toBe(
      "Modelica.Blocks.Continuous.PID",
    );

    fireDispose();
    expect(DocumentationEditorProvider.activeClassName()).toBeUndefined();
  });

  it("renders a placeholder and never reads OMC for an unresolved class", async () => {
    const { panel, webview, posted } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.resolve(makeResolveClient({ info: "" })),
    );

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      docFor(vscode.Uri.file("/ws/Foo.mo")),
    );
    await flush();

    expect(webview.html).not.toContain("om-documentation-root");
    expect(ensureClient).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});

// ── controller (write + reverse) ─────────────────────────────────────────────

const CLASS = "Pkg.M";
const SRC_URI = vscode.Uri.parse("modelica-source:/Pkg.M.mo");
const LISTED =
  'model M annotation(Documentation(info="<html><p>new</p></html>")); end M;';

function srcDoc(text = "buffer text"): vscode.TextDocument {
  return {
    uri: SRC_URI,
    lineCount: 1,
    getText: () => text,
  } as unknown as vscode.TextDocument;
}

function makeGate(): {
  gate: ReadyGate<DocExtensionToWebview>;
  posted: DocExtensionToWebview[];
} {
  const posted: DocExtensionToWebview[] = [];
  return {
    posted,
    gate: { send: (m) => posted.push(m), markReady: () => {} },
  };
}

function makeShadowFactory(): {
  factory: (onForeign: (d: vscode.TextDocument) => void) => {
    write(t: string): Promise<void>;
    dispose(): void;
  };
  writes: string[];
  fireForeign: () => void;
} {
  const writes: string[] = [];
  let captured: ((d: vscode.TextDocument) => void) | undefined;
  return {
    writes,
    fireForeign: () => captured?.(srcDoc()),
    factory: (onForeign) => {
      captured = onForeign;
      return {
        write: (t) => {
          writes.push(t);
          return Promise.resolve();
        },
        dispose: () => {},
      };
    },
  };
}

function manualScheduler(): { scheduler: Scheduler; flush: () => void } {
  let pending: (() => void) | undefined;
  return {
    scheduler: {
      schedule(fn) {
        pending = fn;
        return {
          cancel: () => {
            if (pending === fn) pending = undefined;
          },
        };
      },
    },
    flush: () => {
      const fn = pending;
      pending = undefined;
      fn?.();
    },
  };
}

interface EditClientCalls {
  setArgs: { typeName: string; info: string }[];
  loaded: string[];
}

function makeEditClient(
  anno: {
    info: string;
    fail?: boolean;
  },
  opts?: {
    setOk?: boolean;
    loadOk?: boolean;
    contents?: string;
    systemLib?: boolean;
  },
): { client: DocumentationClient; calls: EditClientCalls } {
  const calls: EditClientCalls = { setArgs: [], loaded: [] };
  const client: DocumentationClient = {
    ...verdictWrappers(opts?.systemLib ?? false),
    getDocumentationAnnotation: vi.fn(() =>
      anno.fail
        ? Promise.reject(new Error("OMC down"))
        : Promise.resolve({ info: anno.info }),
    ),
    getClassRestriction: vi.fn(() => Promise.resolve({ restriction: "block" })),
    getModelInstance: vi.fn(() => Promise.resolve({ instance: PID_INSTANCE })),
    setFullDocumentationAnnotation: vi.fn(
      (a: { typeName: string; info: string }) => {
        calls.setArgs.push(a);
        return Promise.resolve({ success: opts?.setOk ?? true });
      },
    ),
    listFile: vi.fn(() =>
      Promise.resolve({ contents: opts?.contents ?? LISTED }),
    ),
    loadString: vi.fn((a: { data: string }) => {
      calls.loaded.push(a.data);
      return Promise.resolve({ success: opts?.loadOk ?? true });
    }),
    getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
    uriToFilename: vi.fn(() => Promise.resolve({ filename: "" })),
  };
  return { client, calls };
}

describe("DocumentationEditController write path", () => {
  it("writes the edit through OMC, then reflects the canonical source", async () => {
    const { client, calls } = makeEditClient({
      info: "<html><p>orig</p></html>",
    });
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc(),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
    );

    controller.start();
    await controller.handle({
      type: "edit",
      info: "<html><p>edited</p></html>",
    });

    expect(calls.setArgs).toEqual([
      { typeName: CLASS, info: "<html><p>edited</p></html>" },
    ]);
    expect(writes).toEqual([LISTED]); // canonical source reflected; dirty is VSCode's
  });

  it("refuses an edit on a read-only class and never writes", async () => {
    const { client, calls } = makeEditClient(
      { info: "<html></html>" },
      { systemLib: true },
    );
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc(),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
    );

    controller.start();
    await controller.handle({ type: "edit", info: "<html><p>x</p></html>" });

    expect(calls.setArgs).toEqual([]);
    expect(writes).toEqual([]);
    expect(posted.some((m) => m.type === "error")).toBe(true);
  });

  it("refuses an edit before the first fetch has seeded the controller", async () => {
    const { client, calls } = makeEditClient({ info: "", fail: true });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc(),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
    );

    controller.start(); // fetch fails → never seeded
    await controller.handle({ type: "edit", info: "<html><p>x</p></html>" });

    expect(calls.setArgs).toEqual([]);
    expect(writes).toEqual([]);
    expect(posted.some((m) => m.type === "error")).toBe(true);
  });

  it("re-syncs on an external write: reflects the source and re-sends the doc", async () => {
    const { client } = makeEditClient({ info: "<html><p>after</p></html>" });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc(),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
    );

    controller.start();
    await controller.refreshFromExternalWrite();

    // The native HTML editor already wrote OMC; the controller reflects the
    // canonical source into the (possibly dirty) buffer and re-sends the doc.
    expect(writes).toEqual([LISTED]);
    expect(posted.filter((m) => m.type === "doc").length).toBeGreaterThan(0);
  });

  it("refuses an external-write refresh on a read-only class and never reflects it", async () => {
    const { client } = makeEditClient(
      { info: "<html><p>after</p></html>" },
      { systemLib: true },
    );
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc(),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
    );

    controller.start();
    await controller.refreshFromExternalWrite();

    // The reflect is skipped, but the webview still needs the re-sent doc so
    // it can't hold a stale `info`/`readOnly` state.
    expect(writes).toEqual([]);
    expect(posted.some((m) => m.type === "doc")).toBe(true);
  });

  it("reverse-syncs a foreign buffer change: loadString then re-send the doc", async () => {
    const { client, calls } = makeEditClient({ info: "<html><p>x</p></html>" });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushTimer } = manualScheduler();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc("undone text"),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
      scheduler,
    );

    controller.start();
    await Promise.resolve();
    posted.length = 0; // drop the initial doc

    fireForeign();
    flushTimer();
    await flush();

    expect(calls.loaded).toEqual(["undone text"]);
    expect(posted.some((m) => m.type === "doc")).toBe(true);
  });

  it("refuses a reverse sync on a read-only class and never loads it into OMC", async () => {
    const { client, calls } = makeEditClient(
      { info: "<html><p>x</p></html>" },
      { systemLib: true },
    );
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushTimer } = manualScheduler();
    const controller = new DocumentationEditController(
      {
        client,
        document: srcDoc("undone text"),
        className: CLASS,
        gate,
        writeVerdicts: new WriteVerdicts(),
      },
      factory,
      scheduler,
    );

    controller.start();
    await Promise.resolve();
    posted.length = 0; // drop the initial doc

    fireForeign();
    flushTimer();
    await flush();

    expect(calls.loaded).toEqual([]);
    expect(posted.some((m) => m.type === "error")).toBe(true);
  });
});
