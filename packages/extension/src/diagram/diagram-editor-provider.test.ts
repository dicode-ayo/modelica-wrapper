/**
 * `diagram-editor-provider` renders a class's diagram in a read-only custom
 * editor. These pin the contracts the plumbing rests on: which class a `.mo`
 * document resolves to (the `modelica-source:` fast path and the `file:`
 * `parseFile` path), and that the layout is seeded to the webview only after
 * its `ready` handshake — never before, and never when no class resolves.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config,
 * so this runs in plain Node.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type {
  ComponentElement,
  DiagramLayout,
  ModelInstance,
  OmcClient,
} from "@dicode/omc-client";

import {
  appliedEdits,
  pendingApplies,
  setApplyEditManual,
  setApplyEditResult,
} from "../../test-support/vscode-mock.js";
import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";
import type { ReadyGate } from "../webview/ready-gate.js";
import {
  classNameFromDocument,
  DiagramEditController,
  resolveDiagramEditor,
  type Scheduler,
} from "./diagram-editor-provider.js";
import { createShadowBuffer, type ShadowBuffer } from "./shadow-buffer.js";

beforeEach(() => {
  appliedEdits.length = 0;
  pendingApplies.length = 0;
  setApplyEditManual(false);
  setApplyEditResult(true);
});

/**
 * A minimal instance with an Icon coordinate system — enough for the producer
 * to emit a "diagram" layout without hand-crafting record shapes.
 */
const INSTANCE: ModelInstance = {
  name: "Modelica.Blocks.Math.Gain",
  restriction: "model",
  elements: [],
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [],
    },
  },
} as unknown as ModelInstance;

const EXT_URI = vscode.Uri.file("/ext");

interface FakeWebview {
  options: unknown;
  cspSource: string;
  html: string;
  asWebviewUri: (u: vscode.Uri) => vscode.Uri;
  postMessage: (m: ExtensionToWebview) => Promise<boolean>;
  onDidReceiveMessage: (l: (m: WebviewToExtension) => void) => {
    dispose(): void;
  };
}

function makePanel(): {
  panel: vscode.WebviewPanel;
  webview: FakeWebview;
  posted: ExtensionToWebview[];
  fireReady: () => void;
} {
  const posted: ExtensionToWebview[] = [];
  let listener: ((m: WebviewToExtension) => void) | undefined;
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
    onDidDispose: (_l: () => void) => ({ dispose: () => {} }),
  };
  return {
    panel: panel as unknown as vscode.WebviewPanel,
    webview,
    posted,
    fireReady: () => listener?.({ type: "ready" }),
  };
}

function makeClient(opts?: {
  parseFile?: (fileName: string) => Promise<{ classNames: string[] }>;
  getModelInstance?: (typeName: string) => Promise<{ instance: ModelInstance }>;
}): {
  client: OmcClient;
  seenTypeName: () => string | undefined;
  parsedFiles: string[];
} {
  const parsedFiles: string[] = [];
  let seen: string | undefined;
  const client = {
    parseFile: vi.fn((input: { fileName: string }) => {
      parsedFiles.push(input.fileName);
      return (
        opts?.parseFile?.(input.fileName) ??
        Promise.resolve({ classNames: [] as string[] })
      );
    }),
    invoke: vi.fn((fn: string, args: { typeName: string }) => {
      if (fn === "getModelInstance") {
        seen = args.typeName;
        return (
          opts?.getModelInstance?.(args.typeName) ??
          Promise.resolve({ instance: INSTANCE })
        );
      }
      // getInstantiatedParametersAndValues is best-effort; a rejection leaves
      // the layout's resolved parameters undefined.
      return Promise.reject(new Error(`unexpected invoke: ${fn}`));
    }),
  } as unknown as OmcClient;
  return { client, seenTypeName: () => seen, parsedFiles };
}

/** Drain the async resolution + layout fetch. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Let queued controller units (edit / reverse-sync) settle. */
async function drain(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function docFor(uri: vscode.Uri): vscode.TextDocument {
  return { uri } as unknown as vscode.TextDocument;
}

describe("classNameFromDocument", () => {
  it("decodes the dotted name from a modelica-source URI", () => {
    const uri = vscode.Uri.parse(
      "modelica-source:/Modelica.Blocks.Math.Gain.mo",
    );
    expect(classNameFromDocument(docFor(uri))).toBe(
      "Modelica.Blocks.Math.Gain",
    );
  });

  it("returns undefined for a real file: .mo (resolved separately via OMC)", () => {
    expect(classNameFromDocument(docFor(vscode.Uri.file("/ws/Foo.mo")))).toBe(
      undefined,
    );
  });
});

describe("resolveDiagramEditor: modelica-source fast path", () => {
  it("queues the layout until ready, then posts a single init, without parseFile", async () => {
    const { panel, webview, posted, fireReady } = makePanel();
    const { client, parsedFiles } = makeClient();
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      docFor(vscode.Uri.parse("modelica-source:/Modelica.Blocks.Math.Gain.mo")),
    );
    expect(webview.html).toContain("om-webview-root");

    await flush();
    expect(posted).toEqual([]); // held back until the webview signals ready

    fireReady();
    expect(posted).toHaveLength(1);
    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") {
      expect(msg.className).toBe("Modelica.Blocks.Math.Gain");
      expect(msg.layout).toBeDefined();
    }
    expect(parsedFiles).toEqual([]);
  });

  it("posts an error, not an init, when the layout fetch throws", async () => {
    const { panel, posted, fireReady } = makePanel();
    const { client } = makeClient({
      getModelInstance: () => Promise.reject(new Error("OMC down")),
    });
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      docFor(vscode.Uri.parse("modelica-source:/Pkg.Broken.mo")),
    );

    await flush();
    fireReady();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe("error");
  });
});

describe("resolveDiagramEditor: on-disk file: path", () => {
  it("resolves the class via parseFile and renders it", async () => {
    const { panel, webview, posted, fireReady } = makePanel();
    const { client, seenTypeName, parsedFiles } = makeClient({
      parseFile: () => Promise.resolve({ classNames: ["Foo.Bar"] }),
    });
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      docFor(vscode.Uri.file("/ws/Foo.mo")),
    );

    await flush();
    expect(parsedFiles).toEqual(["/ws/Foo.mo"]);
    expect(webview.html).toContain("om-webview-root");
    expect(seenTypeName()).toBe("Foo.Bar"); // layout fetched for the resolved class
    expect(posted).toEqual([]); // queued until ready

    fireReady();
    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") expect(msg.className).toBe("Foo.Bar");
  });

  it("renders the placeholder when the file declares no class", async () => {
    const { panel, webview, posted } = makePanel();
    const { client } = makeClient({
      parseFile: () => Promise.resolve({ classNames: [] }),
    });
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      docFor(vscode.Uri.file("/ws/Empty.mo")),
    );

    await flush();
    expect(webview.html).toContain("library sidebar");
    expect(webview.html).not.toContain("om-webview-root");
    expect(posted).toEqual([]);
  });

  it("renders the placeholder and never touches OMC for a non-file scheme", async () => {
    const { panel, webview, posted } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.reject(new Error("must not be called")),
    );

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      docFor(vscode.Uri.parse("untitled:/foo.mo")),
    );

    await flush();
    expect(webview.html).toContain("library sidebar");
    expect(ensureClient).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});

const LISTED_SOURCE = "model M end M;";

function makeEditClient(opts?: {
  loadStringSuccess?: boolean;
  instance?: ModelInstance;
}): {
  client: OmcClient;
  invoked: string[];
  addComponentCalls: Array<Record<string, unknown>>;
  addConnectionCalls: Array<Record<string, unknown>>;
  listedTypes: string[];
  loadStringCalls: Array<Record<string, unknown>>;
  setModifierCalls: Array<Record<string, unknown>>;
  removeModifierCalls: Array<Record<string, unknown>>;
  ops: string[];
} {
  const invoked: string[] = [];
  const addComponentCalls: Array<Record<string, unknown>> = [];
  const addConnectionCalls: Array<Record<string, unknown>> = [];
  const listedTypes: string[] = [];
  const loadStringCalls: Array<Record<string, unknown>> = [];
  const setModifierCalls: Array<Record<string, unknown>> = [];
  const removeModifierCalls: Array<Record<string, unknown>> = [];
  const ops: string[] = [];
  const client = {
    lastCall: "mock",
    invoke: vi.fn((fn: string) => {
      invoked.push(fn);
      if (fn === "getModelInstance")
        return Promise.resolve({ instance: opts?.instance ?? INSTANCE });
      if (fn === "getInstantiatedParametersAndValues") {
        return Promise.reject(new Error("no params"));
      }
      // updateComponent / deleteComponent / addConnection / ... report success.
      return Promise.resolve({ success: true });
    }),
    addComponent: vi.fn((input: Record<string, unknown>) => {
      ops.push("addComponent");
      addComponentCalls.push(input);
      return Promise.resolve({ success: true });
    }),
    addConnection: vi.fn((input: Record<string, unknown>) => {
      addConnectionCalls.push(input);
      return Promise.resolve({ success: true });
    }),
    listFile: vi.fn((input: { typeName: string }) => {
      ops.push("listFile");
      listedTypes.push(input.typeName);
      return Promise.resolve({ contents: LISTED_SOURCE });
    }),
    loadString: vi.fn((input: Record<string, unknown>) => {
      ops.push("loadString");
      loadStringCalls.push(input);
      return Promise.resolve({ success: opts?.loadStringSuccess ?? true });
    }),
    setElementModifierValue: vi.fn((input: Record<string, unknown>) => {
      ops.push("setElementModifierValue");
      setModifierCalls.push(input);
      return Promise.resolve({ success: true });
    }),
    setExtendsModifierValue: vi.fn((input: Record<string, unknown>) => {
      ops.push("setExtendsModifierValue");
      setModifierCalls.push(input);
      return Promise.resolve({ success: true });
    }),
    removeElementModifiers: vi.fn((input: Record<string, unknown>) => {
      ops.push("removeElementModifiers");
      removeModifierCalls.push(input);
      return Promise.resolve({ success: true });
    }),
    getErrorString: vi.fn(() => Promise.resolve({ errorString: "boom" })),
  } as unknown as OmcClient;
  return {
    client,
    invoked,
    addComponentCalls,
    addConnectionCalls,
    listedTypes,
    loadStringCalls,
    setModifierCalls,
    removeModifierCalls,
    ops,
  };
}

function makeGate(): { gate: ReadyGate; posted: ExtensionToWebview[] } {
  const posted: ExtensionToWebview[] = [];
  return {
    gate: {
      send: (m: ExtensionToWebview) => posted.push(m),
      markReady: () => {},
    },
    posted,
  };
}

type ShadowFactory = (
  onForeignChange: (doc: vscode.TextDocument) => void,
) => ShadowBuffer;

/**
 * A fake shadow that records reflected writes and captures the controller's
 * `onForeignChange` callback so tests can drive a foreign change directly.
 */
function makeShadowFactory(): {
  factory: ShadowFactory;
  writes: string[];
  fireForeign: (doc?: vscode.TextDocument) => void;
} {
  const writes: string[] = [];
  let captured: ((doc: vscode.TextDocument) => void) | undefined;
  const factory: ShadowFactory = (onForeignChange) => {
    captured = onForeignChange;
    return {
      write: (t: string) => {
        writes.push(t);
        return Promise.resolve();
      },
      dispose: () => {},
    };
  };
  return {
    factory,
    writes,
    fireForeign: (doc = SRC_DOC) => captured?.(doc),
  };
}

/** A scheduler whose single pending callback the test fires via `flush`. */
function manualScheduler(): {
  scheduler: Scheduler;
  flush: () => void;
  scheduleCount: () => number;
} {
  let pending: (() => void) | undefined;
  let count = 0;
  return {
    scheduler: {
      schedule(fn) {
        count += 1;
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
    scheduleCount: () => count,
  };
}

function srcDoc(text = LISTED_SOURCE): vscode.TextDocument {
  return {
    uri: vscode.Uri.parse("modelica-source:/Pkg.M.mo"),
    lineCount: 1,
    getText: () => text,
  } as unknown as vscode.TextDocument;
}

const SRC_DOC = srcDoc();

function layout(fields: Partial<DiagramLayout>): DiagramLayout {
  return {
    className: "Pkg.M",
    components: {},
    connectors: {},
    connections: [],
    classes: {},
    iconLayers: [],
    diagramLayers: [],
    ...fields,
  } as unknown as DiagramLayout;
}

function movedComponent(extent: number[][]): DiagramLayout {
  return layout({
    components: {
      gain1: {
        classRef: "Modelica.Blocks.Math.Gain",
        placement: { extent, rotation: 0 },
      },
    } as unknown as DiagramLayout["components"],
  });
}

describe("DiagramEditController: forward write path", () => {
  it("reflects a component move into the buffer after mutating OMC", async () => {
    const { client, invoked, listedTypes } = makeEditClient();
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      movedComponent([
        [-10, -10],
        [10, 10],
      ]),
      factory,
    );

    await controller.handle({
      type: "change",
      layout: movedComponent([
        [0, 0],
        [20, 20],
      ]),
    });

    expect(invoked).toContain("updateComponent");
    expect(listedTypes).toContain("Pkg.M");
    expect(writes).toEqual([LISTED_SOURCE]); // dirty state is VSCode-managed
  });

  it("adds a component and reflects the buffer", async () => {
    const { client, addComponentCalls, listedTypes } = makeEditClient();
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 5, y: 5 },
    });

    expect(addComponentCalls[0]).toMatchObject({
      componentName: "gain1",
      componentClass: "Modelica.Blocks.Math.Gain",
      intoTypeName: "Pkg.M",
    });
    expect(String(addComponentCalls[0]?.annotation)).toContain("Placement");
    expect(listedTypes).toEqual(["Pkg.M"]);
    expect(writes).toEqual([LISTED_SOURCE]);
  });

  it("adds a connection between standalone connectors and reflects the buffer", async () => {
    const { client, addConnectionCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({
        connectors: { p: {}, q: {} } as unknown as DiagramLayout["connectors"],
      }),
      factory,
    );

    await controller.handle({
      type: "connectionCreate",
      fromKey: "k:p",
      toKey: "k:q",
      waypoints: [],
    });

    expect(addConnectionCalls[0]).toMatchObject({
      from: "p",
      to: "q",
      typeName: "Pkg.M",
    });
    expect(writes).toEqual([LISTED_SOURCE]);
  });

  it("does not reflect when a connection endpoint can't be resolved", async () => {
    const { client, addConnectionCalls } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({
      type: "connectionCreate",
      fromKey: "k:p",
      toKey: "k:q",
      waypoints: [],
    });

    expect(addConnectionCalls).toEqual([]);
    expect(writes).toEqual([]);
    expect(posted.at(-1)?.type).toBe("error");
  });

  it("serializes queued edits so each apply→reflect finishes before the next", async () => {
    const { client, ops } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    const first = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    const second = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Add",
      position: { x: 1, y: 1 },
    });
    await Promise.all([first, second]);

    // Serialized: the first edit's reflect (listFile) completes before the
    // second edit's mutation begins — not interleaved.
    expect(ops).toEqual([
      "addComponent",
      "listFile",
      "addComponent",
      "listFile",
    ]);
  });

  it("routes a failed buffer reflect through the error path", async () => {
    const { client } = makeEditClient();
    const { gate, posted } = makeGate();
    const rejectingShadow: ShadowFactory = () => ({
      write: () => Promise.reject(new Error("applyEdit rejected")),
      dispose: () => {},
    });
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      rejectingShadow,
    );

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });

    expect(posted.at(-1)?.type).toBe("error");
  });

  it("reverse-syncs a foreign change: loadString the buffer, refetch, no reflect", async () => {
    const { client, loadStringCalls, invoked } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      {
        client,
        document: srcDoc("model M2 end M2;"),
        className: "Pkg.M",
        gate,
      },
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    flushDebounce();
    await drain();

    expect(loadStringCalls[0]).toMatchObject({
      data: "model M2 end M2;",
      merge: false,
    });
    expect(invoked).toContain("getModelInstance"); // layout re-fetched
    expect(posted.at(-1)?.type).toBe("layout"); // pushed to the webview
    expect(writes).toEqual([]); // no reflect back into the buffer
    controller.dispose();
  });

  it("serializes a reverse sync after an in-flight forward edit", async () => {
    const { client, ops } = makeEditClient();
    const { gate } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
      scheduler,
    );

    const edit = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    fireForeign();
    flushDebounce();
    await edit;
    await drain();

    // The forward edit fully applies + reflects before the reverse sync loads.
    expect(ops).toEqual(["addComponent", "listFile", "loadString"]);
    controller.dispose();
  });

  it("keeps the last-good render and does not poison the queue when loadString fails", async () => {
    const { client, addComponentCalls } = makeEditClient({
      loadStringSuccess: false,
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    flushDebounce();
    await drain();

    expect(posted.at(-1)?.type).toBe("error");
    expect(posted.some((m) => m.type === "layout")).toBe(false); // last-good kept

    // A subsequent edit still dispatches — the queue wasn't poisoned.
    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    expect(addComponentCalls).toHaveLength(1);
    controller.dispose();
  });

  it("debounces a burst of foreign changes into a single reverse sync", async () => {
    const { client, loadStringCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    fireForeign();
    fireForeign();
    flushDebounce();
    await drain();

    expect(loadStringCalls).toHaveLength(1);
    controller.dispose();
  });

  it("does not reverse-sync on our own reflect write (real self-write guard)", async () => {
    const { client, loadStringCalls } = makeEditClient();
    const { gate } = makeGate();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const doc = srcDoc();
    const controller = new DiagramEditController(
      { client, document: doc, className: "Pkg.M", gate },
      layout({}),
      (onForeignChange) => createShadowBuffer(doc, onForeignChange),
      scheduler,
    );

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    // The reflect's own applyEdit fired a change event; the guard must keep it
    // out of the reverse path, so nothing is scheduled and no loadString runs.
    flushDebounce();
    await drain();

    expect(loadStringCalls).toEqual([]);
    controller.dispose();
  });
});

const CLASS_PARAM_INSTANCE = {
  name: "Pkg.M",
  restriction: "model",
  elements: [
    {
      $kind: "component",
      name: "gain",
      type: "Real",
      value: { binding: 2 },
      prefixes: { variability: "parameter" },
    },
  ],
} as unknown as ModelInstance;

/** A sub-component whose type declares a single Real parameter `k`. */
function componentInstance(): ModelInstance {
  return {
    name: "Pkg.M",
    restriction: "model",
    elements: [
      {
        $kind: "component",
        name: "PI",
        type: {
          name: "MyLib.Block",
          restriction: "block",
          elements: [
            {
              $kind: "component",
              name: "k",
              type: "Real",
              value: { binding: 1 },
              prefixes: { variability: "parameter" },
            },
          ],
        },
      } as unknown as ComponentElement,
    ],
  } as unknown as ModelInstance;
}

describe("DiagramEditController: parameter editing", () => {
  it("opens the class-parameter modal (read) without reflecting", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionParameters" });

    const open = posted.find((m) => m.type === "parametersOpen");
    expect(open).toMatchObject({ kind: "classParams" });
    expect(setModifierCalls).toEqual([]); // a modal open is a read
    expect(writes).toEqual([]); // reads never reflect to the buffer
  });

  it("applies a changed class parameter to OMC and reflects to the buffer", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionParameters" });
    await controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 5 },
    });

    expect(setModifierCalls[0]).toMatchObject({
      typeName: "Pkg.M",
      elementName: "gain",
    });
    expect(String(setModifierCalls[0]?.expr)).toContain("5");
    expect(writes).toContain(LISTED_SOURCE); // reflected + dirty
    expect(posted.at(-1)?.type).toBe("parametersClose");
  });

  it("does not write an unchanged class parameter", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionParameters" });
    await controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 2 },
    });

    expect(setModifierCalls).toEqual([]);
  });

  it("applies a changed component parameter as <comp>.<param> and reflects", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: componentInstance(),
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({ type: "editComponent", componentName: "PI" });
    const open = posted.find((m) => m.type === "parametersOpen");
    expect(open).toMatchObject({ kind: "componentParams", crefPrefix: "PI" });

    await controller.handle({
      type: "parametersSubmit",
      kind: "componentParams",
      values: { k: 3 },
    });

    expect(setModifierCalls[0]).toMatchObject({
      typeName: "Pkg.M",
      elementName: "PI.k",
    });
    expect(writes).toContain(LISTED_SOURCE);
  });

  it("resets a component's modifiers (keepRedeclares) and re-opens the modal", async () => {
    const { client, removeModifierCalls } = makeEditClient({
      instance: componentInstance(),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({
      type: "resetComponentParameters",
      componentName: "PI",
    });

    expect(removeModifierCalls[0]).toMatchObject({
      typeName: "Pkg.M",
      componentName: "PI",
      keepRedeclares: true,
    });
    expect(posted.at(-1)).toMatchObject({
      type: "parametersOpen",
      kind: "componentParams",
    });
  });

  it("serializes a parameter submit after an in-flight forward edit", async () => {
    const { client, ops } = makeEditClient({ instance: CLASS_PARAM_INSTANCE });
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionParameters" }); // seed refs/values
    const edit = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    const submit = controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 5 },
    });
    await Promise.all([edit, submit]);

    // The forward edit fully applies + reflects before the submit's write.
    expect(ops).toEqual([
      "addComponent",
      "listFile",
      "setElementModifierValue",
      "listFile",
    ]);
  });
});
