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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type {
  ComponentElement,
  DiagramLayout,
  ModelInstance,
  OmcClient,
} from "@dicode/omc-client";

import * as vscodeMock from "../../test-support/vscode-mock.js";
import {
  appliedEdits,
  executedCommands,
  pendingApplies,
  setApplyEditManual,
  setApplyEditResult,
} from "../../test-support/vscode-mock.js";

// The change-class path constructs a real `LibrarySource`; stub it so the
// quick-pick search resolves without an OMC library round-trip.
vi.mock("./library-source.js", () => ({
  LibrarySource: class {
    searchAll = vi.fn().mockResolvedValue([]);
    listChildren = vi.fn().mockResolvedValue([]);
  },
  SearchAbortedError: class extends Error {},
}));
import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";
import type { ReadyGate } from "../webview/ready-gate.js";
import { WriteVerdicts } from "../write-verdict.js";
import { type Scheduler } from "./buffer-sync.js";
import { DiagramClipboard } from "./clipboard.js";
import {
  classNameFromDocument,
  DiagramEditController,
  DiagramEditorProvider,
  DIAGRAM_VIEW_TYPE,
  ICON_VIEW_TYPE,
  resolveDiagramEditor,
} from "./diagram-editor-provider.js";
import { createShadowBuffer, type ShadowBuffer } from "./shadow-buffer.js";

/** Stands in for whatever sentence the write verdict refuses with. */
const REFUSAL = "Cannot edit Pkg.M — its source file is read-only.";

beforeEach(() => {
  appliedEdits.length = 0;
  pendingApplies.length = 0;
  executedCommands.length = 0;
  setApplyEditManual(false);
  setApplyEditResult(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A `QuickPick` double for `pickClassToSwap`: on `show()` it fires `onDidAccept`
 * with `pickedLabel` selected, or `onDidHide` when the label is `undefined`.
 */
function stubQuickPick(pickedLabel: string | undefined): unknown {
  let acceptCb: (() => void) | undefined;
  let hideCb: (() => void) | undefined;
  const qp = {
    title: "",
    placeholder: "",
    matchOnDescription: false,
    busy: false,
    items: [] as unknown[],
    value: "",
    selectedItems: [] as { label: string }[],
    onDidChangeValue: () => ({ dispose: () => {} }),
    onDidAccept: (cb: () => void) => {
      acceptCb = cb;
      return { dispose: () => {} };
    },
    onDidHide: (cb: () => void) => {
      hideCb = cb;
      return { dispose: () => {} };
    },
    show: () => {
      queueMicrotask(() => {
        if (pickedLabel !== undefined) {
          qp.selectedItems = [{ label: pickedLabel }];
          acceptCb?.();
        } else {
          hideCb?.();
        }
      });
    },
    hide: () => hideCb?.(),
    dispose: () => {},
  };
  return qp;
}

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

/** A placeable sub-component class — enough for the diagram producer to place it. */
const GAIN_TYPE: unknown = {
  name: "Modelica.Blocks.Math.Gain",
  restriction: "block",
  elements: [],
};

/**
 * An instance of `Pkg.M` with a single real, placed sub-component — run
 * through the actual `produceDiagramLayout` (via `fetchDiagramLayout`), not
 * the `layout()`/`movedComponent()` shortcuts that bypass it. Used where a
 * test needs the reverse sync's refetch to resolve a component the
 * hand-built webview-side layout doesn't know about.
 */
function instanceWithComponent(
  name: string,
  extent: [[number, number], [number, number]],
): ModelInstance {
  return {
    name: "Pkg.M",
    restriction: "model",
    elements: [
      {
        $kind: "component",
        name,
        type: GAIN_TYPE,
        annotation: { Placement: { transformation: { extent } } },
      },
    ],
  } as unknown as ModelInstance;
}

const EXT_URI = vscode.Uri.file("/ext");

interface FakeWebview {
  options: unknown;
  cspSource: string;
  html: string;
  asWebviewUri: (u: vscode.Uri) => vscode.Uri;
  postMessage: (m: ExtensionToWebview) => Promise<boolean>;
  onDidReceiveMessage: (l: (m: unknown) => void) => {
    dispose(): void;
  };
}

function makePanel(active = false): {
  panel: vscode.WebviewPanel;
  webview: FakeWebview;
  posted: ExtensionToWebview[];
  fireReady: () => void;
  fireMessage: (m: unknown) => void;
  fireViewState: (isActive: boolean) => void;
  fireDispose: () => void;
} {
  const posted: ExtensionToWebview[] = [];
  let listener: ((m: unknown) => void) | undefined;
  let viewStateListener:
    ((e: { webviewPanel: { active: boolean } }) => void) | undefined;
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
    fireMessage: (m) => listener?.(m),
    fireViewState: (isActive) => {
      panel.active = isActive;
      viewStateListener?.({ webviewPanel: { active: isActive } });
    },
    fireDispose: () => disposeListener?.(),
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
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("modelica-source:/Modelica.Blocks.Math.Gain.mo")),
      "diagram",
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

  it("posts a renderError, not an init, when the layout fetch throws", async () => {
    const { panel, posted, fireReady } = makePanel();
    const { client } = makeClient({
      getModelInstance: () => Promise.reject(new Error("OMC down")),
    });
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("modelica-source:/Pkg.Broken.mo")),
      "diagram",
    );

    await flush();
    fireReady();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      type: "renderError",
      className: "Pkg.Broken",
      mode: "diagram",
      detail: "OMC down",
    });
  });

  it("evaluates readOnly after the layout fetch resolves the class", async () => {
    const { panel, posted, fireReady } = makePanel();
    // Read-only becomes visible only once the fetch has resolved the class: an
    // unresolved class has no source file to classify, so a verdict taken
    // before the fetch (a restored tab) would read writable.
    let fetched = false;
    const { client } = makeClient({
      getModelInstance: () => {
        fetched = true;
        return Promise.resolve({ instance: INSTANCE });
      },
    });
    const resolving = {
      ...client,
      getSourceFile: vi.fn(() =>
        Promise.resolve({
          fileName: fetched
            ? "/home/u/.openmodelica/libraries/Modelica/Blocks/package.mo"
            : "",
        }),
      ),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileReadOnly: false }),
      ),
    } as unknown as OmcClient;
    const ensureClient = vi.fn(() => Promise.resolve(resolving));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("modelica-source:/Modelica.Blocks.Math.Gain.mo")),
      "diagram",
    );
    await flush();
    fireReady();

    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") expect(msg.readOnly).toBe(true);
  });
});

/**
 * A client whose `invoke` records the OMC functions it was asked for and
 * answers both `getModelInstance` and the icon-only `getModelInstanceAnnotation`
 * with the same instance — enough to tell the diagram fetch path (full
 * instance) from the icon fetch path (annotation-filtered) apart.
 */
function makeModeClient(): { client: OmcClient; invokedFns: string[] } {
  const invokedFns: string[] = [];
  const client = {
    invoke: vi.fn((fn: string) => {
      invokedFns.push(fn);
      if (fn === "getModelInstance" || fn === "getModelInstanceAnnotation") {
        return Promise.resolve({ instance: INSTANCE });
      }
      return Promise.reject(new Error(`unexpected invoke: ${fn}`));
    }),
  } as unknown as OmcClient;
  return { client, invokedFns };
}

const GAIN_MODE_DOC = docFor(
  vscode.Uri.parse("modelica-source:/Modelica.Blocks.Math.Gain.mo"),
);

describe("resolveDiagramEditor: render mode", () => {
  it("icon mode fetches the icon layout and posts an icon-kind init", async () => {
    const { panel, posted, fireReady } = makePanel();
    const { client, invokedFns } = makeModeClient();
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      GAIN_MODE_DOC,
      "icon",
    );
    await flush();
    fireReady();

    expect(invokedFns).toContain("getModelInstanceAnnotation"); // icon path
    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") expect(msg.layout.kind).toBe("icon");
  });

  it("diagram mode fetches the diagram layout without the icon annotation call", async () => {
    const { panel, posted, fireReady } = makePanel();
    const { client, invokedFns } = makeModeClient();
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      GAIN_MODE_DOC,
      "diagram",
    );
    await flush();
    fireReady();

    expect(invokedFns).toContain("getModelInstance");
    expect(invokedFns).not.toContain("getModelInstanceAnnotation");
    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") expect(msg.layout.kind).toBe("diagram");
  });
});

describe("DiagramEditorProvider: registration", () => {
  it("registers both viewTypes, each provider carrying its mode", async () => {
    const registered: Array<{
      viewType: string;
      provider: vscode.CustomTextEditorProvider;
    }> = [];
    vi.spyOn(
      vscodeMock.window,
      "registerCustomEditorProvider",
    ).mockImplementation(((
      viewType: string,
      provider: vscode.CustomTextEditorProvider,
    ) => {
      registered.push({ viewType, provider });
      return { dispose: () => {} };
    }) as never);
    const context = {
      extensionUri: EXT_URI,
    } as unknown as vscode.ExtensionContext;
    const ensureClient = (): Promise<OmcClient> =>
      Promise.resolve(makeModeClient().client);

    DiagramEditorProvider.register(
      context,
      ensureClient,
      new WriteVerdicts(),
      DIAGRAM_VIEW_TYPE,
      "diagram",
    );
    DiagramEditorProvider.register(
      context,
      ensureClient,
      new WriteVerdicts(),
      ICON_VIEW_TYPE,
      "icon",
    );

    expect(registered.map((r) => r.viewType)).toEqual([
      "modelica.diagram",
      "modelica.icon",
    ]);

    // The registered icon provider carries "icon" mode: resolving it produces
    // an icon-kind layout, which only the icon fetch path emits.
    const iconEntry = registered.find((r) => r.viewType === ICON_VIEW_TYPE);
    if (iconEntry === undefined)
      throw new Error("icon provider not registered");
    const { panel, posted, fireReady } = makePanel();
    iconEntry.provider.resolveCustomTextEditor(
      GAIN_MODE_DOC,
      panel,
      {} as vscode.CancellationToken,
    );
    await flush();
    fireReady();
    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") expect(msg.layout.kind).toBe("icon");
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
      new WriteVerdicts(),
      docFor(vscode.Uri.file("/ws/Foo.mo")),
      "diagram",
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
      new WriteVerdicts(),
      docFor(vscode.Uri.file("/ws/Empty.mo")),
      "diagram",
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
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("untitled:/foo.mo")),
      "diagram",
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
  /** Make OMC refuse every `updateComponent`, so the batch rolls back. */
  updateComponentFails?: boolean;
  /** Fires as each call is dispatched, to interleave a message mid-apply. */
  onInvoke?: (fn: string) => void;
  setElementTypeSuccess?: boolean;
  setElementTypeThrows?: boolean;
  getModelInstanceThrows?: boolean;
  classRestriction?: string;
  classRestrictionThrows?: boolean;
  isPartial?: boolean;
  /** Modifier name → expression, answered for every element the copy reads. */
  modifiers?: Record<string, string>;
  /** Whether OMC accepts the paste block. */
  pasteSuccess?: boolean;
}): {
  client: OmcClient;
  invoked: string[];
  addComponentCalls: Array<Record<string, unknown>>;
  addConnectionCalls: Array<Record<string, unknown>>;
  listedTypes: string[];
  loadStringCalls: Array<Record<string, unknown>>;
  setModifierCalls: Array<Record<string, unknown>>;
  removeModifierCalls: Array<Record<string, unknown>>;
  setElementTypeCalls: Array<Record<string, unknown>>;
  simulateCalls: Array<Record<string, unknown>>;
  graphicsWrites: Array<Record<string, unknown>>;
  pasteBlocks: string[];
  classInfoQueries: string[];
  ops: string[];
} {
  const invoked: string[] = [];
  const pasteBlocks: string[] = [];
  const addComponentCalls: Array<Record<string, unknown>> = [];
  const addConnectionCalls: Array<Record<string, unknown>> = [];
  const listedTypes: string[] = [];
  const loadStringCalls: Array<Record<string, unknown>> = [];
  const setModifierCalls: Array<Record<string, unknown>> = [];
  const removeModifierCalls: Array<Record<string, unknown>> = [];
  const setElementTypeCalls: Array<Record<string, unknown>> = [];
  const simulateCalls: Array<Record<string, unknown>> = [];
  const graphicsWrites: Array<Record<string, unknown>> = [];
  const classInfoQueries: string[] = [];
  const ops: string[] = [];
  const client = {
    lastCall: "mock",
    invoke: vi.fn((fn: string, input?: Record<string, unknown>) => {
      invoked.push(fn);
      opts?.onInvoke?.(fn);
      // The icon fetch path uses the annotation-filtered call; answer it with
      // the same instance so an icon-mode re-fetch resolves.
      if (fn === "getModelInstance" || fn === "getModelInstanceAnnotation") {
        return opts?.getModelInstanceThrows
          ? Promise.reject(new Error("getModelInstance failed"))
          : Promise.resolve({ instance: opts?.instance ?? INSTANCE });
      }
      if (fn === "getInstantiatedParametersAndValues") {
        return Promise.reject(new Error("no params"));
      }
      if (fn === "writeClassGraphics") {
        if (input !== undefined) graphicsWrites.push(input);
        return Promise.resolve({ success: true });
      }
      if (fn === "updateComponent" && opts?.updateComponentFails) {
        return Promise.resolve({ success: false });
      }
      // updateComponent / deleteComponent / addConnection / ... report success.
      return Promise.resolve({ success: true });
    }),
    getClassInformation: vi.fn((input: { typeName: string }) => {
      classInfoQueries.push(input.typeName);
      return opts?.classRestrictionThrows
        ? Promise.reject(new Error("getClassInformation failed"))
        : Promise.resolve({ restriction: opts?.classRestriction ?? "model" });
    }),
    isPartial: vi.fn((_input: { typeName: string }) => {
      ops.push("isPartial");
      return Promise.resolve({ b: opts?.isPartial ?? false });
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
    loadClassContentString: vi.fn((input: Record<string, unknown>) => {
      ops.push("loadClassContentString");
      pasteBlocks.push(String(input.data));
      return Promise.resolve({ success: opts?.pasteSuccess ?? true });
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
    setElementType: vi.fn((input: Record<string, unknown>) => {
      ops.push("setElementType");
      setElementTypeCalls.push(input);
      if (opts?.setElementTypeThrows) {
        return Promise.reject(new Error("setElementType threw"));
      }
      return Promise.resolve({ success: opts?.setElementTypeSuccess ?? true });
    }),
    simulate: vi.fn((input: Record<string, unknown>) => {
      ops.push("simulate");
      simulateCalls.push(input);
      return Promise.resolve({
        simulationResult: { kind: "call", name: "SimulationResult", args: [] },
      });
    }),
    getElementModifierNames: vi.fn(() => {
      ops.push("getElementModifierNames");
      return Promise.resolve({ modifiers: Object.keys(opts?.modifiers ?? {}) });
    }),
    getElementModifierValue: vi.fn((input: { modifier: string }) => {
      ops.push("getElementModifierValue");
      const path = input.modifier.slice(input.modifier.indexOf(".") + 1);
      return Promise.resolve({ value: opts?.modifiers?.[path] ?? "" });
    }),
    getErrorString: vi.fn(() => Promise.resolve({ errorString: "boom" })),
  } as unknown as OmcClient;
  return {
    client,
    invoked,
    addComponentCalls,
    addConnectionCalls,
    pasteBlocks,
    listedTypes,
    loadStringCalls,
    setModifierCalls,
    removeModifierCalls,
    setElementTypeCalls,
    simulateCalls,
    graphicsWrites,
    classInfoQueries,
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

/**
 * A buffer whose text has diverged from what OMC holds (`LISTED_SOURCE`) — the
 * precondition for a reverse sync, since a buffer that still matches the class
 * has nothing to load back.
 */
const EDITED_DOC = srcDoc("model M Real x; end M;");

type ControllerDeps = ConstructorParameters<typeof DiagramEditController>[0];

/** The deps every controller test builds; pass only what the test varies. */
function controllerDeps(
  base: Pick<ControllerDeps, "client" | "gate"> & Partial<ControllerDeps>,
): ControllerDeps {
  return {
    document: SRC_DOC,
    className: "Pkg.M",
    clipboard: new DiagramClipboard(),
    onClipboardChanged: () => {},
    ...base,
  };
}

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
    // The re-fetch is the diff base, so the mock has to report the class as
    // the pre-move layout describes it.
    const { client, invoked, listedTypes } = makeEditClient({
      instance: instanceWithComponent("gain1", [
        [-10, -10],
        [10, 10],
      ]),
    });
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
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
      staleBase: false,
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
      controllerDeps({ client, gate }),
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

  it("refuses to add a partial class and never writes it", async () => {
    const { client, addComponentCalls } = makeEditClient({ isPartial: true });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Interfaces.PartialBlock",
      position: { x: 5, y: 5 },
    });

    expect(addComponentCalls).toEqual([]);
    expect(writes).toEqual([]);
    expect(posted.at(-1)).toEqual({
      type: "error",
      message:
        "Modelica.Blocks.Interfaces.PartialBlock is a partial class and cannot be placed as a component.",
    });
  });

  it("adds a connection between standalone connectors and reflects the buffer", async () => {
    const { client, addConnectionCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
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
      controllerDeps({ client, gate }),
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
      controllerDeps({ client, gate }),
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
      "isPartial",
      "addComponent",
      "listFile",
      "isPartial",
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
      controllerDeps({ client, gate }),
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
      controllerDeps({ client, gate, document: EDITED_DOC }),
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    flushDebounce();
    await drain();

    expect(loadStringCalls[0]).toMatchObject({
      data: EDITED_DOC.getText(),
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
      controllerDeps({ client, gate, document: EDITED_DOC }),
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

    // The forward edit fully applies + reflects before the reverse sync reads
    // the class to compare the buffer against and loads it back.
    expect(ops).toEqual([
      "isPartial",
      "addComponent",
      "listFile",
      "listFile",
      "loadString",
    ]);
    controller.dispose();
  });

  it("flushes a pending reverse sync before a racing forward edit lands", async () => {
    const { client, ops } = makeEditClient();
    const { gate } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: EDITED_DOC }),
      layout({}),
      factory,
      scheduler,
    );

    // An undo (foreign change) schedules the debounced reverse sync — the
    // timer hasn't fired yet.
    fireForeign();
    // A webview drag arrives inside that ~150ms window, before the debounce
    // would otherwise fire.
    const edit = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    await edit;
    await drain();

    // The pending reverse sync is flushed ahead of the racing forward edit, so
    // the undo lands in OMC before the drag diffs against `prevLayout` — never
    // the other way around, which would silently discard the undo.
    expect(ops).toEqual([
      "listFile",
      "loadString",
      "isPartial",
      "addComponent",
      "listFile",
    ]);
    controller.dispose();
  });

  it("drops a racing 'change' message flushed against a pending reverse sync, instead of diffing a stale snapshot", async () => {
    // The reverse sync's refetch resolves gain1 as a real, placed
    // component — the reload restored it (e.g. an undone deletion). The
    // racing "change" message's `next` (built by the webview before the
    // reload) has no components at all, mirroring the diagram as it stood
    // pre-undo. Left undropped, diffing this `next` against the
    // post-reload `prevLayout` would read gain1 as newly deleted and fire
    // a real `deleteComponent` — exactly the corruption this guard exists
    // to prevent.
    const { client, ops, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", [
        [-10, -10],
        [10, 10],
      ]),
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: EDITED_DOC }),
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    const edit = controller.handle({
      type: "change",
      layout: layout({}),
      staleBase: false,
    });
    await edit;
    await drain();

    // Only the flushed reverse sync runs — the stale `next` is never diffed
    // against the refreshed `prevLayout`, so gain1 is never reported as
    // deleted to OMC.
    expect(ops).toEqual(["listFile", "loadString"]);
    expect(invoked).not.toContain("deleteComponent");
    expect(posted.some((m) => m.type === "error")).toBe(true);
    controller.dispose();
  });

  it("drops a racing 'change' message even after the debounce timer has fired but the reverse sync hasn't resolved", async () => {
    // Same corruption setup as above, but the race lands in the narrower
    // window between the debounce timer firing (`reverseTimer` already
    // cleared) and the enqueued reverse sync's own OMC round-trip completing.
    // There is no timer left to flush, so what orders the two is the queue the
    // sync is already sitting in, ahead of the report.
    const { client, ops, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", [
        [-10, -10],
        [10, 10],
      ]),
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: EDITED_DOC }),
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    flushDebounce(); // the timer fires; the reverse sync is enqueued, not yet resolved
    const edit = controller.handle({
      type: "change",
      layout: layout({}),
      staleBase: false,
    });
    await edit;
    await drain();

    expect(ops).toEqual(["listFile", "loadString"]);
    expect(invoked).not.toContain("deleteComponent");
    expect(posted.some((m) => m.type === "error")).toBe(true);
    controller.dispose();
  });

  it("drops a 'change' message reported while the reverse sync's own OMC calls run", async () => {
    // The narrowest window: no timer left to flush and the sync already
    // running, so the report is stored mid-`loadString`/refetch and its
    // dispatch queues behind. Reconciling it would diff a layout built before
    // the reload against the class the reload restored.
    // The report has to land while the sync's OMC calls are in flight, so the
    // client fires it from inside the refetch.
    let racingReport: (() => void) | undefined;
    const { client, ops, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", [
        [-10, -10],
        [10, 10],
      ]),
      onInvoke: (fn) => {
        if (fn !== "getModelInstance") return;
        const report = racingReport;
        racingReport = undefined;
        report?.();
      },
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: EDITED_DOC }),
      layout({}),
      factory,
      scheduler,
    );
    racingReport = () =>
      void controller.handle({
        type: "change",
        layout: layout({}),
        staleBase: false,
      });

    fireForeign();
    flushDebounce();
    await drain();

    expect(racingReport).toBeUndefined(); // the window was actually entered
    expect(ops).toEqual(["listFile", "loadString"]);
    expect(invoked).not.toContain("deleteComponent");
    expect(
      posted.some((m) => m.type === "error" && m.message.includes("resynced")),
    ).toBe(true);
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
      controllerDeps({ client, gate, document: EDITED_DOC }),
      layout({}),
      factory,
      scheduler,
    );

    fireForeign();
    flushDebounce();
    await drain();

    expect(posted.some((m) => m.type === "error")).toBe(true);
    // The sync wrote nothing, having dropped whatever was reported to make way
    // for it. The webview is put back on the last good layout rather than left
    // rendering an edit no class ever took.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(1);

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
      controllerDeps({ client, gate, document: EDITED_DOC }),
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

  it("does not reverse-sync a mutation announced back into this editor's buffer", async () => {
    // A class-scoped OMC mutation is announced from the call seam, so the
    // source provider reloads the `modelica-source:` document this editor is
    // showing. That reload is not one of the shadow buffer's own writes, so it
    // arrives here as a foreign change — but the buffer it left behind is the
    // class's own source, and loading it back would announce again.
    const { client, ops, loadStringCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
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
    await edit;
    flushDebounce();
    await drain();

    expect(loadStringCalls).toEqual([]);
    expect(ops).toEqual(["isPartial", "addComponent", "listFile", "listFile"]);
    controller.dispose();
  });

  it("keeps a gesture that races this editor's own announced mutation", async () => {
    // The gesture lands inside the debounce window the announcement opened, so
    // it is flushed against a reverse sync that turns out to have nothing to
    // do. Nothing external changed, so the user is not told to retry and the
    // drag is reconciled.
    const { client, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", [
        [-10, -10],
        [10, 10],
      ]),
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent([
        [-10, -10],
        [10, 10],
      ]),
      factory,
      scheduler,
    );

    const edit = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    fireForeign();
    const drag = controller.handle({
      type: "change",
      layout: movedComponent([
        [0, 0],
        [20, 20],
      ]),
      staleBase: false,
    });
    await edit;
    await drag;
    await drain();

    expect(posted.filter((m) => m.type === "error")).toEqual([]);
    expect(invoked).toContain("updateComponent");
    controller.dispose();
  });

  it("does not reverse-sync on our own reflect write (real self-write guard)", async () => {
    const { client, loadStringCalls } = makeEditClient();
    const { gate } = makeGate();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const doc = srcDoc();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: doc }),
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

/** A component whose type declares no editable (parameter-variability) member. */
function componentInstanceNoParams(): ModelInstance {
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
              name: "y",
              type: "Real",
              prefixes: { variability: "" },
            },
          ],
        },
      } as unknown as ComponentElement,
    ],
  } as unknown as ModelInstance;
}

describe("DiagramEditController: reconciling reports", () => {
  const AT = (x: number): [[number, number], [number, number]] => [
    [x, x],
    [x + 20, x + 20],
  ];

  it("applies only the latest report when several arrive before it can keep up", async () => {
    const { client, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", AT(-10)),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent(AT(-10)),
      factory,
    );

    // Reported back to back, so the second and third land while the first is
    // still being reconciled. Each carries the whole layout, so the last one
    // says everything its predecessors did.
    const reports = [0, 10, 20].map((x) =>
      controller.handle({
        type: "change",
        layout: movedComponent(AT(x)),
        staleBase: false,
      }),
    );
    await Promise.all(reports);
    await drain();

    expect(invoked.filter((f) => f === "updateComponent")).toHaveLength(1);
    // And nothing said back: the webview is already showing what the class
    // now holds, so a settle could only arrive late enough to land on a
    // gesture that has moved past it.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(0);
    controller.dispose();
  });

  it("pays a settle owed by another edit path once the reports stop", async () => {
    // A reported edit needs no settle, but a drop, paste or parameter edit is
    // carrying something the webview has no other way to learn. Suppressed
    // because a report was queued behind it, that settle has to survive the
    // reconcile of the report rather than being dropped with it.
    let interleave: (() => void) | undefined;
    const { client } = makeEditClient({
      instance: instanceWithComponent("gain1", AT(-10)),
      onInvoke: (fn) => {
        // The add path's own re-fetch, which runs just before it settles.
        if (fn !== "getModelInstance") return;
        const fire = interleave;
        interleave = undefined;
        fire?.();
      },
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent(AT(-10)),
      factory,
    );

    interleave = () => {
      void controller.handle({
        type: "change",
        layout: movedComponent(AT(0)),
        staleBase: false,
      });
    };
    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 5, y: 5 },
    });
    await drain();

    // One settle, carrying the added component — not one for the add and
    // another for the report that suppressed it.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(1);
    controller.dispose();
  });

  it("does not settle a reported graphics write, same as any other reported edit", async () => {
    const { client, invoked } = makeEditClient({
      instance: diagramRectInstance([
        [0, 0],
        [10, 10],
      ]),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      shapeLayout(),
      factory,
    );

    await controller.handle({
      type: "change",
      layout: layout({
        diagramLayers: [
          { from: "Pkg.M", shapes: [RECT, RECT] },
        ] as unknown as DiagramLayout["diagramLayers"],
      }),
      staleBase: false,
    });
    await drain();

    expect(invoked).toContain("writeClassGraphics");
    // The webview is already showing what it reported; a settle could only
    // arrive late enough to land on a gesture that has moved past it.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(0);
    controller.dispose();
  });

  it("pays an owed settle even when the report that carried it diffs to nothing", async () => {
    // A null diff proves the diffed projection matches — placements, wires,
    // own shapes. A debt owed by a parameter edit or a class swap is carrying
    // what the diff never compares, so cancelling it there loses it for good.
    let interleave: (() => void) | undefined;
    const { client } = makeEditClient({
      onInvoke: (fn) => {
        if (fn !== "getModelInstance") return;
        const fire = interleave;
        interleave = undefined;
        fire?.();
      },
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    interleave = () => {
      // The default instance renders an empty diagram, so this reports it
      // exactly as OMC already holds it and the reconcile writes nothing.
      void controller.handle({
        type: "change",
        layout: layout({}),
        staleBase: false,
      });
    };
    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 5, y: 5 },
    });
    await drain();

    expect(posted.filter((m) => m.type === "layout")).toHaveLength(1);
    controller.dispose();
  });

  it("reconciles against the class as OMC holds it, not against a cached copy", async () => {
    // The cached layout and the report agree; OMC does not. Diffing the two
    // that agree yields nothing, and the class stays where it drifted to.
    const { client, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", AT(99)),
    });
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent(AT(0)),
      factory,
    );

    await controller.handle({
      type: "change",
      layout: movedComponent(AT(0)),
      staleBase: false,
    });

    expect(invoked).toContain("updateComponent");
    controller.dispose();
  });

  it("settles a read-only class back, so a refused drag does not stay on screen", async () => {
    const { client, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", AT(-10)),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent(AT(-10)),
      factory,
      undefined,
      { ok: false, reason: REFUSAL }, // read-only: an MSL class renders and answers reads, refuses writes
    );

    await controller.handle({
      type: "change",
      layout: movedComponent(AT(0)),
      staleBase: false,
    });
    await drain();

    expect(invoked).not.toContain("updateComponent");
    expect(posted.some((m) => m.type === "error")).toBe(true);
    // The webview moved it optimistically; nothing else would put it back.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(1);
    controller.dispose();
  });

  it("keeps reconciling the burst after an edit is refused", async () => {
    // The base is read fresh, so the report queued behind a failure closes the
    // gap from wherever the failed batch left the class. Dropping it would
    // discard the gestures the user made after the one that failed — which is
    // the edit landing at the position before last.
    let interleave: (() => void) | undefined;
    const { client, invoked } = makeEditClient({
      updateComponentFails: true,
      instance: instanceWithComponent("gain1", AT(-10)),
      onInvoke: (fn) => {
        if (fn !== "updateComponent") return;
        const fire = interleave;
        interleave = undefined;
        fire?.();
      },
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent(AT(-10)),
      factory,
    );

    interleave = () => {
      void controller.handle({
        type: "change",
        layout: movedComponent(AT(10)),
        staleBase: false,
      });
    };
    await controller.handle({
      type: "change",
      layout: movedComponent(AT(0)),
      staleBase: false,
    });
    await drain();

    expect(posted.some((m) => m.type === "error")).toBe(true);
    expect(invoked.filter((f) => f === "updateComponent")).toHaveLength(2);
    // Still one settle: the first was withheld behind the queued report.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(1);
    // The snapshot put the class back byte for byte, so nothing reached the
    // buffer — a dirty document and an undo step for an edit that never was.
    expect(writes).toEqual([]);
    controller.dispose();
  });

  it("drops a report that a reverse sync has already overtaken", async () => {
    const { client, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", AT(-10)),
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: EDITED_DOC }),
      movedComponent(AT(-10)),
      factory,
      scheduler,
    );

    fireForeign();
    await controller.handle({
      type: "change",
      layout: layout({}),
      staleBase: false,
    });
    await drain();

    // Reconciling an empty report against the reloaded class would read every
    // component the sync restored as one the user deleted.
    expect(invoked).not.toContain("deleteComponent");
    expect(posted.some((m) => m.type === "error")).toBe(true);
    controller.dispose();
  });
});

describe("DiagramEditController: stale-base reconcile (issue #408)", () => {
  /** OMC's real state: `gain1` (as the report also knows it) plus `gain2` —
   *  e.g. a paste that settled into OMC after the webview's local layout was
   *  last captured, whose own push the webview then refused. */
  const TWO_COMPONENTS: ModelInstance = {
    name: "Pkg.M",
    restriction: "model",
    elements: [
      {
        $kind: "component",
        name: "gain1",
        type: GAIN_TYPE,
        annotation: {
          Placement: {
            transformation: {
              extent: [
                [10, 10],
                [30, 30],
              ],
            },
          },
        },
      },
      {
        $kind: "component",
        name: "gain2",
        type: GAIN_TYPE,
        annotation: {
          Placement: {
            transformation: {
              extent: [
                [50, 50],
                [70, 70],
              ],
            },
          },
        },
      },
    ],
  } as unknown as ModelInstance;

  it("does not delete a component the report never knew about, and resyncs the webview onto it", async () => {
    const { client, invoked } = makeEditClient({ instance: TWO_COMPONENTS });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    // The controller's own starting point mirrors the webview's stale local
    // view: it knows only gain1.
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent([
        [0, 0],
        [20, 20],
      ]),
      factory,
    );

    await controller.handle({
      type: "change",
      // gain1 moved (a genuinely different extent from TWO_COMPONENTS' own —
      // `movedComponent` also bakes in `rotation: 0`, which the producer's
      // output for an un-rotated placement omits, so a same-extent report
      // would still diff as a placement change on that field alone and pass
      // this assertion for the wrong reason); still no gain2 in this report.
      layout: movedComponent([
        [20, 20],
        [40, 40],
      ]),
      staleBase: true,
    });
    await drain();

    // gain1's own move still lands...
    expect(invoked).toContain("updateComponent");
    // ...but gain2 is not read as a user deletion just because the report
    // doesn't mention it.
    expect(invoked).not.toContain("deleteComponent");
    // The webview never saw gain2 (its push was refused), so a settle is
    // forced regardless of the usual "nothing left to tell it" shortcut.
    expect(posted.filter((m) => m.type === "layout")).toHaveLength(1);
    controller.dispose();
  });

  it("still deletes a component the user actually removed when the report is not stale", async () => {
    const { client, invoked } = makeEditClient({
      instance: instanceWithComponent("gain1", [
        [0, 0],
        [20, 20],
      ]),
    });
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      movedComponent([
        [0, 0],
        [20, 20],
      ]),
      factory,
    );

    await controller.handle({
      type: "change",
      layout: layout({}), // report: no components at all — a real deletion
      staleBase: false,
    });
    await drain();

    expect(invoked).toContain("deleteComponent");
    controller.dispose();
  });
});

describe("DiagramEditController: parameter editing", () => {
  it("opens the class-parameter modal (read) without reflecting", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
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
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionParameters" });
    await controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 5 },
      dirty: ["gain"],
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
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionParameters" });
    await controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 2 },
      dirty: ["gain"],
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
      controllerDeps({ client, gate }),
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
      dirty: ["k"],
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
      controllerDeps({ client, gate }),
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
      controllerDeps({ client, gate }),
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
      dirty: ["gain"],
    });
    await Promise.all([edit, submit]);

    // The forward edit fully applies + reflects before the submit's write.
    expect(ops).toEqual([
      "isPartial",
      "addComponent",
      "listFile",
      "setElementModifierValue",
      "listFile",
    ]);
  });
});

const RECT = {
  kind: "rectangle",
  extent: [
    [-40, -40],
    [40, 40],
  ],
  lineColor: [0, 0, 0],
};

function shapeLayout(): DiagramLayout {
  return layout({
    diagramLayers: [
      { from: "Pkg.M", shapes: [RECT] },
    ] as unknown as DiagramLayout["diagramLayers"],
  });
}

// Positional §18.6 Rectangle record, so the producer decodes a real
// RectangleShape into a reverse-synced layout.
const SOLID_LINE = { $kind: "enum", name: "LinePattern.Solid", index: 1 };
const SOLID_FILL = { $kind: "enum", name: "FillPattern.Solid", index: 1 };
const NO_BORDER = { $kind: "enum", name: "BorderPattern.None", index: 1 };

function rectRecord(extent: number[][]): unknown {
  return {
    $kind: "record",
    name: "Rectangle",
    elements: [
      true,
      [0, 0],
      0,
      [0, 0, 0],
      [255, 255, 255],
      SOLID_LINE,
      SOLID_FILL,
      1,
      NO_BORDER,
      extent,
      0,
    ],
  };
}

/** An instance whose host Diagram layer carries a single rectangle. */
function diagramRectInstance(extent: number[][]): ModelInstance {
  return {
    name: "Pkg.M",
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
      Diagram: { graphics: [rectRecord(extent)] },
    },
  } as unknown as ModelInstance;
}

describe("DiagramEditController: shape properties", () => {
  it("does not open the shape modal on selection alone", async () => {
    const { client } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      shapeLayout(),
      factory,
    );

    await controller.handle({
      type: "selectionChange",
      keys: ["shape:rectangle:0"],
    });

    // Picking a shape is how a drag on it starts; a modal there interrupts
    // every one of them.
    expect(posted.find((m) => m.type === "parametersOpen")).toBeUndefined();
    controller.dispose();
  });

  it("opens the shape modal on a double click (read, no write)", async () => {
    const { client, invoked } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      shapeLayout(),
      factory,
    );

    await controller.handle({
      type: "editShape",
      key: "shape:rectangle:0",
    });

    expect(posted.find((m) => m.type === "parametersOpen")).toMatchObject({
      kind: "shapeProperties",
    });
    expect(writes).toEqual([]);
    expect(invoked).not.toContain("writeClassGraphics");
  });

  it("applies a shape-property edit after a reported gesture has moved the base", async () => {
    // A reported edit leaves `prevLayout` holding what the webview sent. The
    // shape modal resolves its target and its identity check through
    // `prevLayout`, so it has to survive the report.
    const { client, invoked } = makeEditClient({
      instance: diagramRectInstance([
        [0, 0],
        [10, 10],
      ]),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      shapeLayout(),
      factory,
    );

    await controller.handle({
      type: "change",
      layout: shapeLayout(),
      staleBase: false,
    });
    await drain();

    await controller.handle({
      type: "editShape",
      key: "shape:rectangle:0",
    });
    expect(posted.find((m) => m.type === "parametersOpen")).toMatchObject({
      kind: "shapeProperties",
    });

    await controller.handle({
      type: "parametersSubmit",
      kind: "shapeProperties",
      values: { lineColor: "#ff0000" },
      dirty: ["lineColor"],
    });

    expect(
      posted.filter(
        (m) => m.type === "error" && m.message.includes("shape changed"),
      ),
    ).toEqual([]);
    expect(invoked).toContain("writeClassGraphics");
    controller.dispose();
  });

  it("applies a shape-property edit and reflects the buffer", async () => {
    const { client, invoked } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      shapeLayout(),
      factory,
    );

    await controller.handle({
      type: "editShape",
      key: "shape:rectangle:0",
    });
    await controller.handle({
      type: "parametersSubmit",
      kind: "shapeProperties",
      values: { lineColor: "#ff0000" },
      dirty: ["lineColor"],
    });

    expect(invoked).toContain("writeClassGraphics");
    expect(writes).toContain(LISTED_SOURCE);
    expect(posted.at(-1)?.type).toBe("parametersClose");
  });

  it("refuses the submit when a reverse-sync swapped the shape at the same index/kind", async () => {
    // The reverse-sync's layout carries a DIFFERENT rectangle at diagram
    // index 0 than the one captured at selection.
    const { client, invoked } = makeEditClient({
      instance: diagramRectInstance([
        [0, 0],
        [10, 10],
      ]),
    });
    const { gate, posted } = makeGate();
    const { factory, fireForeign } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, document: EDITED_DOC }),
      shapeLayout(),
      factory,
      scheduler,
    );

    // Capture the selected shape (the hand-crafted RECT).
    await controller.handle({
      type: "editShape",
      key: "shape:rectangle:0",
    });

    // A foreign edit reverse-syncs and replaces prevLayout's index-0 shape.
    fireForeign();
    flushDebounce();
    await drain();

    // Submit the still-open modal — it must not land on the swapped shape.
    await controller.handle({
      type: "parametersSubmit",
      kind: "shapeProperties",
      values: { lineColor: "#ff0000" },
      dirty: ["lineColor"],
    });

    expect(invoked).not.toContain("writeClassGraphics");
    expect(
      posted.some((m) => m.type === "error" && /shape changed/.test(m.message)),
    ).toBe(true);
    controller.dispose();
  });
});

/** A host icon layer carrying `shapes`, for icon-mode edit tests. */
function iconShapeLayout(shapes: unknown[]): DiagramLayout {
  return layout({
    iconLayers: [
      { from: "Pkg.M", shapes },
    ] as unknown as DiagramLayout["iconLayers"],
  });
}

/** A host diagram layer carrying `shapes`, for the diagram-mode regression. */
function diagramShapeLayout(shapes: unknown[]): DiagramLayout {
  return layout({
    diagramLayers: [
      { from: "Pkg.M", shapes },
    ] as unknown as DiagramLayout["diagramLayers"],
  });
}

function iconController(
  client: OmcClient,
  gate: ReadyGate,
  factory: ShadowFactory,
  initial: DiagramLayout,
): DiagramEditController {
  return new DiagramEditController(
    controllerDeps({ client, gate }),
    initial,
    factory,
    undefined,
    { ok: true },
    "icon",
  );
}

describe("DiagramEditController: icon mode", () => {
  it("draws a shape onto the ICON layer and reflects the buffer", async () => {
    const { client, invoked, graphicsWrites } = makeEditClient();
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = iconController(
      client,
      gate,
      factory,
      iconShapeLayout([]),
    );

    await controller.handle({
      type: "change",
      layout: iconShapeLayout([RECT]),
      staleBase: false,
    });

    expect(invoked).toContain("writeClassGraphics");
    // Layer targeting: the draw lands on the icon layer, never the diagram one.
    expect(graphicsWrites[0]).toMatchObject({
      layer: "icon",
      op: { kind: "add" },
    });
    expect(writes).toContain(LISTED_SOURCE); // dirty
    // Mode-driven re-fetch: icon mode re-reads via the annotation-filtered call,
    // so prevLayout stays an icon layout and subsequent draws keep the icon
    // field (a diagram-mode re-fetch would read getModelInstance instead).
    expect(invoked).toContain("getModelInstanceAnnotation");
  });

  it("edits an icon-layer shape via the shape modal and reflects", async () => {
    const { client, invoked, graphicsWrites } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = iconController(
      client,
      gate,
      factory,
      iconShapeLayout([RECT]),
    );

    await controller.handle({
      type: "editShape",
      key: "shape:rectangle:0",
    });
    expect(posted.find((m) => m.type === "parametersOpen")).toMatchObject({
      kind: "shapeProperties",
    });

    await controller.handle({
      type: "parametersSubmit",
      kind: "shapeProperties",
      values: { lineColor: "#ff0000" },
      dirty: ["lineColor"],
    });

    expect(invoked).toContain("writeClassGraphics");
    expect(graphicsWrites.at(-1)).toMatchObject({
      layer: "icon",
      op: { kind: "modify", index: 0 },
    });
    expect(writes).toContain(LISTED_SOURCE);
  });

  it("accepts a connector class onto the icon (addComponent)", async () => {
    const { client, addComponentCalls, classInfoQueries } = makeEditClient({
      classRestriction: "connector",
    });
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = iconController(client, gate, factory, layout({}));

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Interfaces.RealInput",
      position: { x: 0, y: 0 },
    });

    expect(classInfoQueries).toContain("Modelica.Blocks.Interfaces.RealInput");
    expect(addComponentCalls).toHaveLength(1);
    expect(writes).toContain(LISTED_SOURCE);
  });

  it("rejects a non-connector class on the icon and does NOT add it", async () => {
    const { client, addComponentCalls } = makeEditClient({
      classRestriction: "block",
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = iconController(client, gate, factory, layout({}));

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });

    expect(addComponentCalls).toEqual([]);
    expect(writes).toEqual([]);
    expect(
      posted.some((m) => m.type === "error" && /connector/i.test(m.message)),
    ).toBe(true);
  });

  it("ignores a diagram-only change-class request in icon mode", async () => {
    const { client, setElementTypeCalls } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = iconController(client, gate, factory, swapLayout());

    await controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });

    expect(setElementTypeCalls).toEqual([]); // no OMC mutation
    expect(writes).toEqual([]); // no reflect
    expect(posted).toEqual([]); // no modal, no error
  });

  it("ignores a diagram-only class-parameter submit in icon mode", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = iconController(client, gate, factory, layout({}));

    await controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 5 },
      dirty: ["gain"],
    });

    expect(setModifierCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("diagram mode draws the same shape onto the DIAGRAM layer (regression)", async () => {
    const { client, graphicsWrites } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    // Default (diagram) mode — the same gesture must target the diagram layer.
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      diagramShapeLayout([]),
      factory,
    );

    await controller.handle({
      type: "change",
      layout: diagramShapeLayout([RECT]),
      staleBase: false,
    });

    expect(graphicsWrites[0]).toMatchObject({
      layer: "diagram",
      op: { kind: "add" },
    });
  });
});

describe("DiagramEditController: queue resilience", () => {
  it("catches a synchronous dispatch throw so the next unit still runs", async () => {
    const { client, addComponentCalls } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    // An unknown shape kind makes buildShapePropertiesForm throw synchronously
    // inside the editShape dispatch case.
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({
        diagramLayers: [
          { from: "Pkg.M", shapes: [{ kind: "bogus" }] },
        ] as unknown as DiagramLayout["diagramLayers"],
      }),
      factory,
    );

    await controller.handle({
      type: "editShape",
      key: "shape:bogus:0",
    });
    expect(posted.at(-1)?.type).toBe("error"); // caught at the chain level

    // The queue survives the throw: a later unit still dispatches.
    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    expect(addComponentCalls).toHaveLength(1);
  });
});

function swapLayout(): DiagramLayout {
  return layout({
    components: {
      r1: {
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
          rotation: 0,
        },
      },
    } as unknown as DiagramLayout["components"],
  });
}

describe("DiagramEditController: change class", () => {
  it("swaps a component's class via setElementType and reflects", async () => {
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick("Modelica.Blocks.Math.Abs") as never,
    );
    const { client, setElementTypeCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      swapLayout(),
      factory,
    );

    await controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });

    expect(setElementTypeCalls[0]).toMatchObject({
      typeName: "Pkg.M.r1",
      newTypeName: "Modelica.Blocks.Math.Abs",
    });
    expect(writes).toContain(LISTED_SOURCE);
  });

  it("is a no-op when the picked class is unchanged", async () => {
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick("Modelica.Blocks.Math.Gain") as never,
    );
    const { client, setElementTypeCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      swapLayout(),
      factory,
    );

    await controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });

    expect(setElementTypeCalls).toEqual([]);
  });

  it("serializes a change-class after an in-flight forward edit", async () => {
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick("Modelica.Blocks.Math.Abs") as never,
    );
    const { client, ops } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      swapLayout(),
      factory,
    );

    const edit = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    const swap = controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });
    await Promise.all([edit, swap]);

    // The forward edit fully applies + reflects before the class swap runs.
    expect(ops).toEqual([
      "isPartial",
      "addComponent",
      "listFile",
      "setElementType",
      "listFile",
    ]);
  });

  it("is a no-op when the pick is dismissed", async () => {
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick(undefined) as never,
    );
    const { client, setElementTypeCalls } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      swapLayout(),
      factory,
    );

    await controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });

    expect(setElementTypeCalls).toEqual([]);
  });
});

describe("DiagramEditController: simulate and check actions", () => {
  it("opens the simulate modal on the simulate action (read, no write)", async () => {
    const { client } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionSimulate" });

    expect(posted.find((m) => m.type === "parametersOpen")).toMatchObject({
      kind: "simulate",
    });
    expect(writes).toEqual([]);
  });

  it("runs simulate on submit without reflecting to the buffer", async () => {
    const { client, simulateCalls } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({
      type: "parametersSubmit",
      kind: "simulate",
      values: { stopTime: 2 },
      dirty: ["stopTime"],
    });

    expect(simulateCalls).toHaveLength(1);
    expect(writes).toEqual([]); // simulate emits a result file, not a source change
    expect(posted.at(-1)?.type).toBe("parametersClose");
  });

  it("routes the check action to modelica.checkModel with the class name", async () => {
    const { client } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({ type: "actionCheck" });

    expect(executedCommands).toContainEqual({
      command: "modelica.checkModel",
      args: ["Pkg.M"],
    });
  });

  it("serializes a simulate submit after an in-flight forward edit", async () => {
    const { client, ops } = makeEditClient();
    const { gate } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    const edit = controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });
    const sim = controller.handle({
      type: "parametersSubmit",
      kind: "simulate",
      values: { stopTime: 1 },
      dirty: ["stopTime"],
    });
    await Promise.all([edit, sim]);

    // The forward edit fully applies + reflects before the simulate runs.
    expect(ops).toEqual(["isPartial", "addComponent", "listFile", "simulate"]);
  });
});

describe("DiagramEditorProvider: active-editor registry", () => {
  it("tracks the active class and routes commands/placement to its webview", async () => {
    const { panel, posted, fireReady, fireViewState } = makePanel();
    const { client } = makeEditClient();
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("modelica-source:/Pkg.M.mo")),
      "diagram",
    );
    fireReady();
    fireViewState(true);

    expect(DiagramEditorProvider.activeClassName()).toBe("Pkg.M");

    posted.length = 0;
    expect(DiagramEditorProvider.runActiveCommand("diagram.delete")).toBe(true);
    expect(posted).toContainEqual({
      type: "runCommand",
      commandId: "diagram.delete",
    });

    posted.length = 0;
    expect(
      DiagramEditorProvider.relayPlacement("Modelica.Blocks.Math.Gain"),
    ).toBe(true);
    expect(posted).toContainEqual({
      type: "placementStart",
      className: "Modelica.Blocks.Math.Gain",
    });

    // Deactivating clears the registry.
    fireViewState(false);
    expect(DiagramEditorProvider.activeClassName()).toBeUndefined();
    expect(DiagramEditorProvider.runActiveCommand("diagram.delete")).toBe(
      false,
    );
    expect(DiagramEditorProvider.relayPlacement(null)).toBe(false);
  });
});

describe("DiagramEditController: writable-class gate", () => {
  function readOnlyController(deps: {
    client: OmcClient;
    gate: ReadyGate;
    factory: ShadowFactory;
    initial?: DiagramLayout;
    scheduler?: Scheduler;
  }): DiagramEditController {
    return new DiagramEditController(
      controllerDeps({ client: deps.client, gate: deps.gate }),
      deps.initial ?? layout({}),
      deps.factory,
      deps.scheduler,
      { ok: false, reason: REFUSAL },
    );
  }

  it("rejects a drag on a read-only class without mutating OMC", async () => {
    const { client, addComponentCalls } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = readOnlyController({ client, gate, factory });

    await controller.handle({
      type: "addComponent",
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 0, y: 0 },
    });

    expect(addComponentCalls).toEqual([]);
    expect(writes).toEqual([]);
    expect(posted.at(-1)?.type).toBe("error");
  });

  it("rejects a parameter submit on a read-only class", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = readOnlyController({ client, gate, factory });

    await controller.handle({ type: "actionParameters" }); // read — allowed
    await controller.handle({
      type: "parametersSubmit",
      kind: "classParams",
      values: { gain: 5 },
      dirty: ["gain"],
    });

    expect(setModifierCalls).toEqual([]); // mutation refused
    expect(posted.some((m) => m.type === "error")).toBe(true);
  });

  it("still opens a modal and runs simulate on a read-only class", async () => {
    const { client, simulateCalls } = makeEditClient({
      instance: CLASS_PARAM_INSTANCE,
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = readOnlyController({ client, gate, factory });

    await controller.handle({ type: "actionParameters" });
    expect(posted.some((m) => m.type === "parametersOpen")).toBe(true);

    await controller.handle({
      type: "parametersSubmit",
      kind: "simulate",
      values: { stopTime: 1 },
      dirty: ["stopTime"],
    });
    expect(simulateCalls).toHaveLength(1);
  });

  it("rejects a reverse sync on a read-only class without loading it into OMC", async () => {
    const { client, loadStringCalls } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory, fireForeign, writes } = makeShadowFactory();
    const { scheduler, flush: flushDebounce } = manualScheduler();
    const controller = readOnlyController({ client, gate, factory, scheduler });

    fireForeign();
    flushDebounce();
    await drain();

    expect(loadStringCalls).toEqual([]);
    expect(writes).toEqual([]);
    expect(posted.some((m) => m.type === "error")).toBe(true);
    controller.dispose();
  });
});

describe("DiagramEditController: change-class error branches", () => {
  it("reports an error and does not reflect when setElementType returns success=false", async () => {
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick("Modelica.Blocks.Math.Abs") as never,
    );
    const { client, setElementTypeCalls } = makeEditClient({
      setElementTypeSuccess: false,
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      swapLayout(),
      factory,
    );

    await controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });

    expect(setElementTypeCalls).toHaveLength(1);
    expect(writes).toEqual([]); // no reflect on failure
    expect(posted.at(-1)?.type).toBe("error");
  });

  it("reports an error when the setElementType RPC throws", async () => {
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick("Modelica.Blocks.Math.Abs") as never,
    );
    const { client } = makeEditClient({ setElementTypeThrows: true });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      swapLayout(),
      factory,
    );

    await controller.handle({
      type: "changeClassRequest",
      componentName: "r1",
      currentClass: "Modelica.Blocks.Math.Gain",
    });

    expect(writes).toEqual([]);
    expect(posted.at(-1)?.type).toBe("error");
  });
});

describe("DiagramEditController: reset error branches", () => {
  it("closes the modal and clears state when the component vanished after reset", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: componentInstance(),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    // Seed component-param state, then reset a name absent from the instance.
    await controller.handle({ type: "editComponent", componentName: "PI" });
    await controller.handle({
      type: "resetComponentParameters",
      componentName: "Ghost",
    });

    expect(posted.at(-1)?.type).toBe("parametersClose"); // modal closed
    // State cleared: a later component submit finds no target and writes nothing.
    await controller.handle({
      type: "parametersSubmit",
      kind: "componentParams",
      values: { k: 9 },
      dirty: ["k"],
    });
    expect(setModifierCalls).toEqual([]);
  });

  it("closes the modal and clears state when no editable params remain", async () => {
    const { client, setModifierCalls } = makeEditClient({
      instance: componentInstanceNoParams(),
    });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({
      type: "resetComponentParameters",
      componentName: "PI",
    });

    expect(posted.at(-1)?.type).toBe("parametersClose");
    await controller.handle({
      type: "parametersSubmit",
      kind: "componentParams",
      values: { k: 9 },
      dirty: ["k"],
    });
    expect(setModifierCalls).toEqual([]);
  });

  it("reports an error when the re-open getModelInstance fails", async () => {
    const { client } = makeEditClient({ getModelInstanceThrows: true });
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({
      type: "resetComponentParameters",
      componentName: "PI",
    });

    expect(posted.at(-1)?.type).toBe("error");
  });
});

describe("DiagramEditController: clipboard", () => {
  const twoGains = (): DiagramLayout =>
    layout({
      components: {
        gain1: {
          classRef: "Modelica.Blocks.Math.Gain",
          placement: {
            extent: [
              [0, 0],
              [20, 20],
            ],
            rotation: 0,
          },
        },
        gain2: {
          classRef: "Modelica.Blocks.Math.Gain",
          placement: {
            extent: [
              [40, 0],
              [60, 20],
            ],
            rotation: 0,
          },
        },
      } as unknown as DiagramLayout["components"],
    });

  function makeController(
    opts: {
      readOnly?: boolean;
      mode?: "diagram" | "icon";
      classRestriction?: string;
      modifiers?: Record<string, string>;
    } = {},
  ): {
    controller: DiagramEditController;
    clipboard: DiagramClipboard;
    posted: ExtensionToWebview[];
    writes: string[];
    ops: string[];
    addComponentCalls: Array<Record<string, unknown>>;
    setModifierCalls: Array<Record<string, unknown>>;
    /** The block each paste handed to OMC. */
    pasteBlocks: string[];
    /** How many times the editor announced a clipboard change. */
    broadcasts: () => number;
  } {
    const { client, ops, addComponentCalls, setModifierCalls, pasteBlocks } =
      makeEditClient({
        ...(opts.classRestriction !== undefined && {
          classRestriction: opts.classRestriction,
        }),
        ...(opts.modifiers !== undefined && { modifiers: opts.modifiers }),
      });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const clipboard = new DiagramClipboard();
    let broadcasts = 0;
    const controller = new DiagramEditController(
      controllerDeps({
        client,
        gate,
        clipboard,
        onClipboardChanged: () => {
          broadcasts += 1;
        },
      }),
      twoGains(),
      factory,
      undefined,
      opts.readOnly === true ? { ok: false, reason: REFUSAL } : { ok: true },
      opts.mode ?? "diagram",
    );
    return {
      controller,
      clipboard,
      posted,
      writes,
      ops,
      addComponentCalls,
      setModifierCalls,
      pasteBlocks,
      broadcasts: () => broadcasts,
    };
  }

  it("fills the clipboard from the selection and announces it", async () => {
    const { controller, clipboard, broadcasts } = makeController({
      modifiers: { k: "2.5" },
    });

    await controller.handle({ type: "copySelection", keys: ["c:gain1"] });

    expect(clipboard.read()).toEqual([
      {
        kind: "component",
        name: "gain1",
        className: "Modelica.Blocks.Math.Gain",
        extent: [
          [0, 0],
          [20, 20],
        ],
        rotation: 0,
        modifiers: [{ path: "k", expr: "2.5" }],
      },
    ]);
    expect(broadcasts()).toBe(1);
  });

  it("copies from a read-only class — only paste writes", async () => {
    const { controller, clipboard, posted } = makeController({
      readOnly: true,
    });

    await controller.handle({ type: "copySelection", keys: ["c:gain1"] });

    expect(clipboard.isEmpty).toBe(false);
    expect(posted.some((m) => m.type === "error")).toBe(false);
  });

  it("refuses to paste into a read-only class", async () => {
    const { controller, clipboard, posted, addComponentCalls } = makeController(
      { readOnly: true },
    );
    await controller.handle({ type: "copySelection", keys: ["c:gain1"] });

    await controller.handle({ type: "paste" });

    expect(addComponentCalls).toEqual([]);
    expect(posted.at(-1)?.type).toBe("error");
    expect(clipboard.isEmpty).toBe(false);
  });

  it("reflects a multi-item paste exactly once, so it is one undo step", async () => {
    const { controller, writes, pasteBlocks } = makeController();
    await controller.handle({
      type: "copySelection",
      keys: ["c:gain1", "c:gain2"],
    });

    await controller.handle({ type: "paste" });

    // Two components, one OMC call: the cost of a paste no longer scales
    // with how much was copied.
    expect(pasteBlocks).toHaveLength(1);
    expect(pasteBlocks[0]?.split("\n")).toHaveLength(2);
    expect(writes).toHaveLength(1);
  });

  it("names each pasted component uniquely against the live layout", async () => {
    const { controller, pasteBlocks } = makeController();
    await controller.handle({
      type: "copySelection",
      keys: ["c:gain1", "c:gain2"],
    });

    await controller.handle({ type: "paste" });

    expect(pasteBlocks[0]).toContain(" gain3 ");
    expect(pasteBlocks[0]).toContain(" gain4 ");
  });

  it("carries the copied modifiers inline on the pasted declaration", async () => {
    const { controller, pasteBlocks, setModifierCalls } = makeController({
      modifiers: { k: "2.5" },
    });
    await controller.handle({ type: "copySelection", keys: ["c:gain1"] });

    await controller.handle({ type: "paste" });

    expect(pasteBlocks[0]).toContain("gain3(k = 2.5)");
    // No separate modifier round-trip — that is where the paste cost went.
    expect(setModifierCalls).toEqual([]);
  });

  it("reports a rejected paste without dirtying the buffer", async () => {
    // OMC parses the block as a unit, so a rejected paste changed nothing —
    // reflecting it would record an undo step for a no-op.
    const { client } = makeEditClient({
      modifiers: { k: "2.5" },
      pasteSuccess: false,
    });
    const { gate, posted } = makeGate();
    const { factory, writes } = makeShadowFactory();
    const clipboard = new DiagramClipboard();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate, clipboard }),
      twoGains(),
      factory,
    );

    await controller.handle({ type: "copySelection", keys: ["c:gain1"] });
    await controller.handle({ type: "paste" });

    expect(writes).toHaveLength(0);
    expect(posted.some((m) => m.type === "error")).toBe(true);
  });

  it("does not reflect when the clipboard has nothing this editor accepts", async () => {
    // A non-connector can't go on an icon, so the paste has no work to do and
    // must not dirty the buffer.
    const { controller, writes, addComponentCalls } = makeController({
      mode: "icon",
      classRestriction: "block",
    });
    // The icon controller reads the same layout; copy the component from it,
    // then paste it back and watch it get filtered out.
    await controller.handle({ type: "copySelection", keys: ["c:gain1"] });

    await controller.handle({ type: "paste" });

    expect(addComponentCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("reports a selection with nothing copyable in it", async () => {
    const { controller, clipboard, posted } = makeController();

    await controller.handle({ type: "copySelection", keys: ["edge:0"] });

    expect(clipboard.isEmpty).toBe(true);
    expect(posted.at(-1)?.type).toBe("error");
  });
});

describe("DiagramEditorProvider: registry dispose", () => {
  it("clears the active editor when the active session disposes", async () => {
    const { panel, fireReady, fireViewState, fireDispose } = makePanel();
    const { client } = makeEditClient();
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(
      panel,
      EXT_URI,
      ensureClient,
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("modelica-source:/Pkg.M.mo")),
      "diagram",
    );
    fireReady();
    fireViewState(true);
    expect(DiagramEditorProvider.activeClassName()).toBe("Pkg.M");

    fireDispose();
    expect(DiagramEditorProvider.activeClassName()).toBeUndefined();
  });
});

describe("the gesture boundary", () => {
  it("drops a message whose payload does not match its declaration", async () => {
    const { panel, fireReady, fireViewState, fireMessage } = makePanel();
    const { client } = makeEditClient();
    resolveDiagramEditor(
      panel,
      EXT_URI,
      vi.fn(() => Promise.resolve(client)),
      new WriteVerdicts(),
      docFor(vscode.Uri.parse("modelica-source:/Pkg.M.mo")),
      "diagram",
    );
    fireReady();
    fireViewState(true);
    await flush();

    const focusUpdates = (): number =>
      executedCommands.filter(
        (c) =>
          c.command === "setContext" &&
          c.args.at(0) === "modelicaDiagramInputFocus",
      ).length;
    const before = focusUpdates();

    fireMessage({ type: "inputFocus", focused: true });
    expect(focusUpdates()).toBe(before + 1);

    // Same gesture, a payload that isn't one: it stops at the boundary rather
    // than reaching the host with a `focused` nobody checked.
    fireMessage({ type: "inputFocus", focused: "yes" });
    fireMessage({ type: "somethingAddedLater" });
    fireMessage("change");
    expect(focusUpdates()).toBe(before + 1);
  });

  it("fails loudly on a message type the dispatch does not handle", async () => {
    // The boundary keeps this out of production; what it pins is that an
    // unhandled gesture reaching the dispatch reports instead of returning.
    const { client } = makeEditClient();
    const { gate, posted } = makeGate();
    const { factory } = makeShadowFactory();
    const controller = new DiagramEditController(
      controllerDeps({ client, gate }),
      layout({}),
      factory,
    );

    await controller.handle({
      type: "somethingAddedLater",
    } as unknown as WebviewToExtension);

    const errors = posted.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors.at(0)).toMatchObject({
      message: expect.stringContaining("WebviewToExtension"),
    });
  });
});
