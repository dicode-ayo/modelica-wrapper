/**
 * `resolveDocumentationEditor` renders a class's `Documentation(info=…)` HTML in
 * a read-only custom editor. These pin the contracts the plumbing rests on: the
 * `info` HTML is seeded to the webview only after its `ready` handshake, a
 * failed OMC read surfaces as an `error` (never a `doc`), and a document whose
 * class can't be resolved renders a placeholder without wiring the bundle.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config, so
 * this runs in plain Node.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { OmcClient } from "@dicode/omc-client";

import type { DocExtensionToWebview } from "../webview/documentation-protocol.js";

import { resolveDocumentationEditor } from "./documentation-editor-provider.js";

const EXT_URI = vscode.Uri.file("/ext");

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

function makePanel(): {
  panel: vscode.WebviewPanel;
  webview: FakeWebview;
  posted: DocExtensionToWebview[];
  fireReady: () => void;
  fireDispose: () => void;
} {
  const posted: DocExtensionToWebview[] = [];
  let listener: ((m: { type: "ready" }) => void) | undefined;
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
    onDidDispose: (l: () => void) => {
      disposeListener = l;
      return { dispose: () => {} };
    },
  };
  return {
    panel: panel as unknown as vscode.WebviewPanel,
    webview,
    posted,
    fireReady: () => listener?.({ type: "ready" }),
    fireDispose: () => disposeListener?.(),
  };
}

function makeClient(
  getDocumentationAnnotation: (input: {
    typeName: string;
  }) => Promise<{ info: string }>,
): { client: OmcClient; seen: () => string | undefined } {
  let seen: string | undefined;
  const client = {
    getDocumentationAnnotation: vi.fn((input: { typeName: string }) => {
      seen = input.typeName;
      return getDocumentationAnnotation(input);
    }),
  } as unknown as OmcClient;
  return { client, seen: () => seen };
}

function docFor(uri: vscode.Uri): vscode.TextDocument {
  return { uri } as unknown as vscode.TextDocument;
}

/** Drain the async OMC read. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const PID_DOC = docFor(
  vscode.Uri.parse("modelica-source:/Modelica.Blocks.Continuous.PID.mo"),
);

describe("resolveDocumentationEditor", () => {
  it("queues the info until ready, then posts a single doc", async () => {
    const { panel, webview, posted, fireReady } = makePanel();
    const { client, seen } = makeClient(() =>
      Promise.resolve({ info: "<html><p>PID</p></html>" }),
    );
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
    expect(webview.html).toContain("om-documentation-root");

    await flush();
    expect(posted).toEqual([]); // held back until the webview signals ready

    fireReady();
    expect(posted).toHaveLength(1);
    const msg = posted[0];
    expect(msg?.type).toBe("doc");
    if (msg?.type === "doc") {
      expect(msg.className).toBe("Modelica.Blocks.Continuous.PID");
      expect(msg.info).toBe("<html><p>PID</p></html>");
    }
    expect(seen()).toBe("Modelica.Blocks.Continuous.PID");
  });

  it("posts an error, not a doc, when the OMC read throws", async () => {
    const { panel, posted, fireReady } = makePanel();
    const { client } = makeClient(() => Promise.reject(new Error("OMC down")));
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDocumentationEditor(panel, EXT_URI, ensureClient, PID_DOC);
    await flush();
    fireReady();

    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe("error");
  });

  it("renders a placeholder and never reads OMC for an unresolved class", async () => {
    const { panel, webview, posted, fireReady } = makePanel();
    const { client } = makeClient(() => Promise.resolve({ info: "" }));
    const ensureClient = vi.fn(() => Promise.resolve(client));

    resolveDocumentationEditor(
      panel,
      EXT_URI,
      ensureClient,
      docFor(vscode.Uri.file("/ws/Foo.mo")),
    );
    await flush();
    fireReady();

    expect(webview.html).not.toContain("om-documentation-root");
    expect(ensureClient).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
