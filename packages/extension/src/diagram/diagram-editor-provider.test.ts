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
import type { ModelInstance, OmcClient } from "@dicode/omc-client";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/protocol.js";
import {
  classNameFromDocument,
  resolveDiagramEditor,
} from "./diagram-editor-provider.js";

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
