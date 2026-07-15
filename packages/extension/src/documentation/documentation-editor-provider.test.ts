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

import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { OmcClient } from "@dicode/omc-client";

import type { DocExtensionToWebview } from "../webview/documentation-protocol.js";
import type { ReadyGate } from "../webview/ready-gate.js";
import { setStatReadonly } from "../../test-support/vscode-mock.js";

import {
  DocumentationEditController,
  DocumentationEditorProvider,
  resolveDocumentationEditor,
  type DocumentationClient,
  type Scheduler,
} from "./documentation-editor-provider.js";

const EXT_URI = vscode.Uri.file("/ext");

afterEach(() => setStatReadonly(false));

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
}): OmcClient {
  return {
    getDocumentationAnnotation: vi.fn(() =>
      Promise.resolve({
        info: anno.info,
        revision: anno.revision ?? "",
        infoHeader: anno.infoHeader ?? "",
      }),
    ),
  } as unknown as OmcClient;
}

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

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
    expect(webview.html).toContain("om-documentation-root");

    await flush();
    expect(posted).toEqual([]); // held back until ready

    fireReady();
    await flush();
    expect(posted).toHaveLength(1);
    const msg = posted[0];
    expect(msg?.type).toBe("doc");
    if (msg?.type === "doc") {
      expect(msg.className).toBe("Modelica.Blocks.Continuous.PID");
      expect(msg.info).toBe("<html><p>PID</p></html>");
      expect(msg.readOnly).toBe(false);
    }
  });

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

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
    await flush();
    fireReady();
    await flush();

    const msg = posted.find((m) => m.type === "doc");
    expect(msg?.type === "doc" && msg.readOnly).toBe(false);
  });

  it("marks an MSL (readonly-stat) source read-only", async () => {
    setStatReadonly(true);
    const { panel, posted, fireReady } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.resolve(makeResolveClient({ info: "<html><p>x</p></html>" })),
    );

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
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

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
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

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
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
  opts?: { setOk?: boolean; loadOk?: boolean; contents?: string },
): { client: DocumentationClient; calls: EditClientCalls } {
  const calls: EditClientCalls = { setArgs: [], loaded: [] };
  const client: DocumentationClient = {
    getDocumentationAnnotation: vi.fn(() =>
      anno.fail
        ? Promise.reject(new Error("OMC down"))
        : Promise.resolve({ info: anno.info }),
    ),
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
      { client, document: srcDoc(), className: CLASS, gate },
      false,
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
    const { client, calls } = makeEditClient({ info: "<html></html>" });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DocumentationEditController(
      { client, document: srcDoc(), className: CLASS, gate },
      true,
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
      { client, document: srcDoc(), className: CLASS, gate },
      false,
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
      { client, document: srcDoc(), className: CLASS, gate },
      false,
      factory,
    );

    controller.start();
    await controller.refreshFromExternalWrite();

    // The native HTML editor already wrote OMC; the controller reflects the
    // canonical source into the (possibly dirty) buffer and re-sends the doc.
    expect(writes).toEqual([LISTED]);
    expect(posted.filter((m) => m.type === "doc").length).toBeGreaterThan(0);
  });

  it("reverse-syncs a foreign buffer change: loadString then re-send the doc", async () => {
    const { client, calls } = makeEditClient({ info: "<html><p>x</p></html>" });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushTimer } = manualScheduler();
    const controller = new DocumentationEditController(
      { client, document: srcDoc("undone text"), className: CLASS, gate },
      false,
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
});
