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
import {
  appliedEdits,
  completeApply,
  pendingApplies,
  setApplyEditManual,
  setApplyEditResult,
} from "../../test-support/vscode-mock.js";

vi.mock("../logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

import type {
  ExtensionToWebview,
  WebviewToExtension,
} from "../webview/postprocessing-protocol.js";
import { log } from "../logger.js";
import { parseResultViewDoc } from "./result-doc.js";
import type { ResultReader } from "./result-cache.js";
import { ResultViewEditorProvider } from "./result-view-provider.js";

const EXT_URI = vscode.Uri.file("/ext");

/** A result view with one result whose fake `statMtimeMs` resolves ("exists")
 *  and one where it resolves `undefined` ("missing"), so a single document
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

/** A `docFor` whose `getText()` reflects the last edit `landEdit` was told
 *  about — unlike `docFor`'s fixed closure, the mock's `applyEdit` doesn't
 *  mutate what `getText()` returns on its own (it only records into
 *  `appliedEdits`), so a test pinning the id-backfill round trip needs a
 *  document double that actually advances. */
function mutableDocFor(text: string): {
  document: vscode.TextDocument;
  landEdit: () => void;
} {
  let current = text;
  const document = {
    uri: vscode.Uri.file("/ws/run.omresults"),
    getText: () => current,
    lineCount: 1,
  } as unknown as vscode.TextDocument;
  return {
    document,
    landEdit: () => {
      const applied = appliedEdits.at(-1)?.replacements[0]?.text;
      if (applied !== undefined) current = applied;
    },
  };
}

function fakeReader(): ResultReader {
  return {
    readSimulationResultVars: () =>
      Promise.resolve({ vars: ["time", "motor.w"] }),
    readSimulationResult: () =>
      Promise.resolve({
        result: [
          [0, 1, 2],
          [10, 20, 30],
        ],
      }),
    closeSimulationResultFile: () => Promise.resolve(undefined),
  };
}

/** Same two results as `DOC_TEXT`, plus a plot card tracing `r2` (the present
 *  one) — the only shape that drives `refresh()` down the `hasTraces` branch. */
const DOC_WITH_TRACE = JSON.stringify({
  version: 1,
  results: [
    { id: "r1", label: "run-1", path: "gone.mat", source: "simulate" },
    { id: "r2", label: "run-2", path: "present.mat", source: "simulate" },
  ],
  cards: [
    {
      kind: "plot",
      id: "c1",
      traces: [{ result: "r2", variable: "motor.w" }],
    },
  ],
});

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
  pendingApplies.length = 0;
  setApplyEditManual(false);
  setApplyEditResult(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResultViewEditorProvider: removeResult / renameResult", () => {
  it("removeResult applies an edit whose new doc no longer has the result", async () => {
    const { fireMessage } = mount();

    fireMessage({ type: "removeResult", resultId: "r1" });

    await vi.waitFor(() => {
      if (appliedEdits.length === 0) throw new Error("no edit applied yet");
    });
    const text = appliedEdits.at(-1)?.replacements[0]?.text;
    expect(text).toBeDefined();
    expect(parseResultViewDoc(text ?? "").results.map((r) => r.id)).toEqual([
      "r2",
    ]);
  });

  it("removeResult is a no-op edit for an unknown id", async () => {
    const { fireMessage } = mount();

    fireMessage({ type: "removeResult", resultId: "ghost" });

    await vi.waitFor(() => {
      if (appliedEdits.length === 0) throw new Error("no edit applied yet");
    });
    const text = appliedEdits.at(-1)?.replacements[0]?.text;
    expect(parseResultViewDoc(text ?? "").results.map((r) => r.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("renameResult applies an edit with the result's label changed", async () => {
    const { fireMessage } = mount();

    fireMessage({ type: "renameResult", resultId: "r1", label: "renamed" });

    await vi.waitFor(() => {
      if (appliedEdits.length === 0) throw new Error("no edit applied yet");
    });
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

describe("ResultViewEditorProvider: refresh with traces", () => {
  it("posts both the missing-file ids and the trace data", async () => {
    const { posted, fireReady } = mount({ docText: DOC_WITH_TRACE });

    fireReady();
    await vi.waitFor(() => {
      const tracedDoc = posted.find(
        (m) => m.type === "doc" && Object.keys(m.traceData).length > 0,
      );
      if (!tracedDoc) throw new Error("traced doc not posted yet");
    });

    const missing = posted.find((m) => m.type === "missingResults");
    expect(missing?.type === "missingResults" && missing.ids).toEqual(["r1"]);

    const tracedDoc = posted.find(
      (m) => m.type === "doc" && Object.keys(m.traceData).length > 0,
    );
    expect(tracedDoc?.type === "doc" && tracedDoc.traceData).toEqual({
      c1: [{ t: [0, 1, 2], values: [10, 20, 30], name: "run-2 / motor.w" }],
    });

    const plotsBusy = posted
      .filter((m) => m.type === "loading" && m.area === "plots")
      .map((m) => m.type === "loading" && m.busy);
    expect(plotsBusy).toEqual([true, false]);
  });

  it("clears the plots spinner on the trace read alone, without waiting for the missing-file scan", async () => {
    let releaseGone: (v: number | undefined) => void = () => {};
    const statMtimeMs = (path: string): Promise<number | undefined> =>
      path.endsWith("gone.mat")
        ? new Promise<number | undefined>((resolve) => {
            releaseGone = resolve;
          })
        : Promise.resolve(100);
    const { posted, fireReady } = mount({
      docText: DOC_WITH_TRACE,
      statMtimeMs,
    });

    fireReady();
    await vi.waitFor(() => {
      if (
        !posted.some(
          (m) => m.type === "loading" && m.area === "plots" && !m.busy,
        )
      ) {
        throw new Error("plots spinner still busy");
      }
    });
    expect(posted.some((m) => m.type === "missingResults")).toBe(false);

    releaseGone(undefined);
    await vi.waitFor(() => {
      if (!posted.some((m) => m.type === "missingResults")) {
        throw new Error("missingResults not posted yet");
      }
    });
  });

  it("drops a superseded generation's posts when it settles after a newer refresh", async () => {
    const stats: { path: string; resolve: (v: number | undefined) => void }[] =
      [];
    const statMtimeMs = (path: string): Promise<number | undefined> =>
      new Promise((resolve) => {
        stats.push({ path, resolve });
      });
    const { posted, fireReady } = mount({
      docText: DOC_WITH_TRACE,
      statMtimeMs,
    });

    fireReady(); // generation 1 — will be superseded before its stats settle
    fireReady(); // generation 2 — the one that should win

    // Two results scanned by missingScan plus one trace read, per generation.
    await vi.waitFor(() => {
      if (stats.length < 6) throw new Error("not all stats requested yet");
    });

    const resolveStat = (s: (typeof stats)[number]): void =>
      s.resolve(s.path.endsWith("gone.mat") ? undefined : 100);

    // Let generation 2's stats settle first.
    stats.slice(3, 6).forEach(resolveStat);
    await vi.waitFor(() => {
      if (!posted.some((m) => m.type === "missingResults")) {
        throw new Error("generation 2 missingResults not posted yet");
      }
    });

    // Generation 1's stats settle late, after generation 2 already won.
    stats.slice(0, 3).forEach(resolveStat);
    await new Promise((r) => setTimeout(r, 10));

    const missingPosts = posted.filter((m) => m.type === "missingResults");
    expect(missingPosts).toHaveLength(1);
    expect(
      missingPosts[0]?.type === "missingResults" && missingPosts[0].ids,
    ).toEqual(["r1"]);

    const tracedDocPosts = posted.filter(
      (m) => m.type === "doc" && Object.keys(m.traceData).length > 0,
    );
    expect(tracedDocPosts).toHaveLength(1);

    const plotsDone = posted.filter(
      (m) => m.type === "loading" && m.area === "plots" && !m.busy,
    );
    expect(plotsDone).toHaveLength(1);
  });
});

describe("ResultViewEditorProvider: backfilled card ids persist across edits", () => {
  // Manual apply mode lets each test decide exactly when the mock's
  // self-triggered `onDidChangeTextDocument` → `refresh()` cascade runs, and
  // update the mutable document's text first — mirroring real VSCode, where
  // `getText()` already reflects an edit by the time its change event fires.
  // Without this, a still-id-less reparse on that cascade would re-backfill
  // (a fresh id) and re-write forever, since the mock never advances
  // `getText()` on its own.

  it("lets deletePlot find a card whose id was backfilled from a hand-written file with none — the bug this fix closes", async () => {
    setApplyEditManual(true);
    const noIdDoc = JSON.stringify({
      version: 1,
      results: [],
      cards: [{ kind: "plot", title: "Plot 1" }],
    });
    const { document, landEdit } = mutableDocFor(noIdDoc);
    const provider = registerProvider(async () => fakeReader());
    const { panel, posted, fireReady, fireMessage } = makePanel();
    provider.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );

    fireReady();
    await vi.waitFor(() => {
      if (pendingApplies.length < 1) throw new Error("no backfill edit yet");
    });
    landEdit(); // the backfill write "lands" before its change event fires
    completeApply(0);

    await vi.waitFor(() => {
      if (!posted.some((m) => m.type === "doc" && m.doc.cards.length > 0)) {
        throw new Error("backfilled doc not posted yet");
      }
    });
    const docMsg = posted.find(
      (m) => m.type === "doc" && m.doc.cards.length > 0,
    );
    const cardId = docMsg?.type === "doc" ? docMsg.doc.cards[0]?.id : undefined;
    expect(cardId).toBeDefined();

    // `cardId` came from the posted doc; deletePlot must match against a
    // re-parse of the on-disk text that carries the same id.
    fireMessage({ type: "deletePlot", cardId: cardId ?? "" });
    await vi.waitFor(() => {
      if (pendingApplies.length < 2) throw new Error("no delete edit yet");
    });
    landEdit();
    completeApply(1);

    const finalText = appliedEdits.at(-1)?.replacements[0]?.text;
    expect(parseResultViewDoc(finalText ?? "").cards).toEqual([]);
  });

  it("persists an applyEdit that backfills ids on the first read, for the plots alias", async () => {
    setApplyEditManual(true);
    const plotsAliasDoc = JSON.stringify({
      version: 1,
      results: [],
      plots: [{ kind: "plot", title: "Plot 1" }],
    });
    const { document, landEdit } = mutableDocFor(plotsAliasDoc);
    const provider = registerProvider(async () => fakeReader());
    const { panel, fireReady } = makePanel();
    provider.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );

    fireReady();
    await vi.waitFor(() => {
      if (pendingApplies.length < 1) throw new Error("no backfill edit yet");
    });
    landEdit();
    completeApply(0);

    // Give the self-triggered refresh a tick to reparse the now-idified text
    // and confirm it does *not* write again.
    await new Promise((r) => setTimeout(r, 10));

    expect(appliedEdits).toHaveLength(1);
    const persisted = parseResultViewDoc(
      appliedEdits[0]?.replacements[0]?.text ?? "",
    );
    expect(persisted.cards).toHaveLength(1);
    expect(persisted.cards[0]?.id).toBeTruthy();
  });

  it("logs a warning when applyEdit resolves false, instead of swallowing the failure", async () => {
    vi.mocked(log.warn).mockClear();
    setApplyEditResult(false);
    const { fireMessage } = mount();

    fireMessage({ type: "removeResult", resultId: "r1" });

    await vi.waitFor(() => {
      if (vi.mocked(log.warn).mock.calls.length === 0) {
        throw new Error("log.warn not called yet");
      }
    });
    expect(log.warn).toHaveBeenCalledWith(
      "resultView",
      expect.stringContaining("applyEdit failed"),
    );
  });
});
