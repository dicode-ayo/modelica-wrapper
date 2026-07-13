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

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type {
  DiagramLayout,
  ModelInstance,
  OmcClient,
} from "@dicode/omc-client";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";
import type { ReadyGate } from "../webview/ready-gate.js";
import {
  classNameFromDocument,
  DiagramEditController,
  resolveDiagramEditor,
} from "./diagram-editor-provider.js";
import type { ShadowBuffer } from "./shadow-buffer.js";

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

function makeEditClient(): {
  client: OmcClient;
  invoked: string[];
  addComponentCalls: Array<Record<string, unknown>>;
  addConnectionCalls: Array<Record<string, unknown>>;
  listedTypes: string[];
  ops: string[];
} {
  const invoked: string[] = [];
  const addComponentCalls: Array<Record<string, unknown>> = [];
  const addConnectionCalls: Array<Record<string, unknown>> = [];
  const listedTypes: string[] = [];
  const ops: string[] = [];
  const client = {
    lastCall: "mock",
    invoke: vi.fn((fn: string) => {
      invoked.push(fn);
      if (fn === "getModelInstance")
        return Promise.resolve({ instance: INSTANCE });
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
  } as unknown as OmcClient;
  return {
    client,
    invoked,
    addComponentCalls,
    addConnectionCalls,
    listedTypes,
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

function makeShadow(): { shadow: ShadowBuffer; writes: string[] } {
  const writes: string[] = [];
  return {
    shadow: {
      write: (t: string) => {
        writes.push(t);
        return Promise.resolve();
      },
      dispose: () => {},
    },
    writes,
  };
}

const SRC_DOC = docFor(vscode.Uri.parse("modelica-source:/Pkg.M.mo"));

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
    const { shadow, writes } = makeShadow();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      movedComponent([
        [-10, -10],
        [10, 10],
      ]),
      shadow,
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
    const { shadow, writes } = makeShadow();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      shadow,
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
    const { shadow, writes } = makeShadow();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({
        connectors: { p: {}, q: {} } as unknown as DiagramLayout["connectors"],
      }),
      shadow,
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
    const { shadow, writes } = makeShadow();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      shadow,
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
    const { shadow } = makeShadow();
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      shadow,
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
    const shadow: ShadowBuffer = {
      write: () => Promise.reject(new Error("applyEdit rejected")),
      dispose: () => {},
    };
    const controller = new DiagramEditController(
      { client, document: SRC_DOC, className: "Pkg.M", gate },
      layout({}),
      shadow,
    );

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });

    expect(posted.at(-1)?.type).toBe("error");
  });
});
