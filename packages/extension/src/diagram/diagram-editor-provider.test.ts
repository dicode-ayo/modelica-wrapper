/**
 * `diagram-editor-provider` renders a class's diagram in a read-only custom
 * editor. These pin the two contracts the plumbing rests on: which class a
 * `.mo` document resolves to, and that the layout is seeded to the webview
 * only after its `ready` handshake (never before, and never on the `file:`
 * fallback path that has no class to render).
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

function makeClient(invoke: (fn: string) => Promise<unknown>): OmcClient {
  return { invoke: vi.fn(invoke) } as unknown as OmcClient;
}

/** Drain the async layout fetch (ensureClient + getModelInstance). */
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

  it("returns undefined for a real file: .mo, which has no class mapping", () => {
    expect(classNameFromDocument(docFor(vscode.Uri.file("/ws/Foo.mo")))).toBe(
      undefined,
    );
  });
});

describe("resolveDiagramEditor: unresolved class (file: fallback)", () => {
  it("renders a placeholder and never touches OMC", async () => {
    const { panel, webview, posted } = makePanel();
    const ensureClient = vi.fn(() =>
      Promise.reject(new Error("must not be called")),
    );

    resolveDiagramEditor(panel, EXT_URI, ensureClient, undefined);

    expect(webview.html).toContain("library sidebar");
    expect(webview.html).not.toContain("om-webview-root");
    await flush();
    expect(ensureClient).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});

describe("resolveDiagramEditor: diagram render", () => {
  it("queues the layout until ready, then posts a single init", async () => {
    const { panel, webview, posted, fireReady } = makePanel();
    const client = makeClient(async (fn) => {
      if (fn === "getModelInstance") return { instance: INSTANCE };
      throw new Error(`unexpected invoke: ${fn}`);
    });
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(panel, EXT_URI, ensureClient, INSTANCE.name);
    expect(webview.html).toContain("om-webview-root");

    await flush();
    expect(posted).toEqual([]); // held back until the webview signals ready

    fireReady();
    expect(posted).toHaveLength(1);
    const msg = posted[0];
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") {
      expect(msg.className).toBe(INSTANCE.name);
      expect(msg.layout).toBeDefined();
    }
    expect(ensureClient).toHaveBeenCalledTimes(1);
  });

  it("posts an error, not an init, when the layout fetch throws", async () => {
    const { panel, posted, fireReady } = makePanel();
    const client = makeClient(async () => {
      throw new Error("OMC down");
    });
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDiagramEditor(panel, EXT_URI, ensureClient, "Pkg.Broken");

    await flush();
    fireReady();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe("error");
  });
});
