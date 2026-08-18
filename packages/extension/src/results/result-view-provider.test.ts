/**
 * `ResultViewEditorProvider` pins the invariants the `*.omresults` webview
 * wiring rests on: `removeResult` / `renameResult` land as real `WorkspaceEdit`s,
 * and `missingResults` is produced on `ready`, keyed by which results' backing
 * files don't exist on disk.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import * as vscodeMock from "../../test-support/vscode-mock.js";
import { appliedEdits } from "../../test-support/vscode-mock.js";

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/postprocessing-protocol.js";
import { parseResultViewDoc } from "./result-doc.js";
import type { ResultReader } from "./result-cache.js";
import { ResultViewEditorProvider } from "./result-view-provider.js";

const EXT_URI = vscode.Uri.file("/ext");

/** A result view with a result whose fake `statMtimeMs` resolves ("exists")
 *  and one whose it resolves `undefined` ("missing"), so a single document
 *  exercises both sides of `missingResults`. */
const DOC_TEXT = JSON.stringify({
  version: 1,
  results: [
    { id: "r1", label: "run-1", path: "gone.mat", source: "simulate" },
    { id: "r2", label: "run-2", path: "present.mat", source: "simulate" },
  ],
  cards: [],
});

/** Fake `statMtimeMs`: resolves for every path except `gone.mat`. */
function fakeStatMtimeMs(): (path: string) => Promise<number | undefined> {
  return (path: string) =>
    Promise.resolve(path.endsWith("gone.mat") ? undefined : 100);
}

function docFor(text = DOC_TEXT): vscode.TextDocument {
  return {
    uri: vscode.Uri.file("/ws/run.omresults"),
    getText: () => text,
    lineCount: 1,
  } as unknown as vscode.TextDocument;
}

function fakeReader(): ResultReader {
  return {
    readSimulationResultVars: () =>
      Promise.reject(new Error("not used by these tests")),
    readSimulationResult: () =>
      Promise.reject(new Error("not used by these tests")),
    closeSimulationResultFile: () => Promise.resolve(undefined),
  };
}

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
  fireMessage: (m: WebviewToExtension) => void;
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
    active: false,
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
  };
  return {
    panel: panel as unknown as vscode.WebviewPanel,
    webview,
    posted,
    fireReady: () => listener?.({ type: "ready" }),
    fireMessage: (m) => listener?.(m),
  };
}

/** Capture the provider `register` hands to `registerCustomEditorProvider`,
 *  since the constructor is private and `register` only returns a `Disposable`. */
function registerProvider(
  ensureClient: () => Promise<ResultReader>,
  statMtimeMs?: (path: string) => Promise<number | undefined>,
): vscode.CustomTextEditorProvider {
  let captured: vscode.CustomTextEditorProvider | undefined;
  vi.spyOn(
    vscodeMock.window,
    "registerCustomEditorProvider",
  ).mockImplementation((_viewType, provider) => {
    captured = provider as vscode.CustomTextEditorProvider;
    return new vscodeMock.Disposable(() => {});
  });
  const context = {
    extensionUri: EXT_URI,
  } as unknown as vscode.ExtensionContext;
  ResultViewEditorProvider.register(context, ensureClient, statMtimeMs);
  if (captured === undefined) throw new Error("provider not registered");
  return captured;
}

/** Register a provider and resolve it against `docFor()`, returning the panel
 *  harness. The fake `statMtimeMs` is the default so no test reaches real
 *  `node:fs` — `applyEdit` fires `onDidChangeTextDocument` synchronously, which
 *  runs `refresh()` and its missing-file scan on every edit. */
function mount({
  statMtimeMs = fakeStatMtimeMs(),
  docText = DOC_TEXT,
}: {
  statMtimeMs?: (path: string) => Promise<number | undefined>;
  docText?: string;
} = {}): {
  posted: ExtensionToWebview[];
  fireReady: () => void;
  fireMessage: (m: WebviewToExtension) => void;
} {
  const provider = registerProvider(async () => fakeReader(), statMtimeMs);
  const { panel, posted, fireReady, fireMessage } = makePanel();
  provider.resolveCustomTextEditor(
    docFor(docText),
    panel,
    {} as vscode.CancellationToken,
  );
  return { posted, fireReady, fireMessage };
}

beforeEach(() => {
  appliedEdits.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResultViewEditorProvider: removeResult / renameResult", () => {
  it("removeResult applies an edit whose new doc no longer has the result", () => {
    const { fireMessage } = mount();

    fireMessage({ type: "removeResult", resultId: "r1" });

    const text = appliedEdits.at(-1)?.replacements[0]?.text;
    expect(text).toBeDefined();
    expect(parseResultViewDoc(text ?? "").results.map((r) => r.id)).toEqual([
      "r2",
    ]);
  });

  it("removeResult is a no-op edit for an unknown id", () => {
    const { fireMessage } = mount();

    fireMessage({ type: "removeResult", resultId: "ghost" });

    const text = appliedEdits.at(-1)?.replacements[0]?.text;
    expect(parseResultViewDoc(text ?? "").results.map((r) => r.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("renameResult applies an edit with the result's label changed", () => {
    const { fireMessage } = mount();

    fireMessage({ type: "renameResult", resultId: "r1", label: "renamed" });

    const text = appliedEdits.at(-1)?.replacements[0]?.text;
    const doc = parseResultViewDoc(text ?? "");
    expect(doc.results.find((r) => r.id === "r1")?.label).toBe("renamed");
    expect(doc.results.find((r) => r.id === "r2")?.label).toBe("run-2");
  });
});

describe("ResultViewEditorProvider: missingResults", () => {
  it("posts the ids whose backing file doesn't exist, on ready", async () => {
    const { posted, fireReady } = mount();

    fireReady();
    await vi.waitFor(() => {
      if (!posted.some((m) => m.type === "missingResults")) {
        throw new Error("no missingResults yet");
      }
    });

    const missing = posted.find((m) => m.type === "missingResults");
    expect(missing?.type === "missingResults" && missing.ids).toEqual(["r1"]);
  });
});
