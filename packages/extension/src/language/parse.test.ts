/**
 * `ParseCache` lifetime/concurrency tests, run against the REAL tree-sitter
 * grammar WASM (mirrors `symbols-provider.test.ts` / `definition-provider.test.ts`)
 * so a `Tree.delete()` call actually frees WASM-backed memory — the class the
 * races below exist to guard against use-after-free in.
 *
 * `ensureLanguage` memoizes its `Language` per `wasmDir` for the process
 * lifetime, so every test here points at the same temp `wasmDir`.
 */

import { cpSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";

import type * as vscode from "vscode";

import { Position, Range, Uri } from "../../test-support/vscode-mock.js";

import {
  GRAMMAR_WASM_FILENAME,
  ParseCache,
  RUNTIME_WASM_FILENAME,
} from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const grammarSource = join(here, "..", "..", "grammar", GRAMMAR_WASM_FILENAME);

let wasmDir: string;

beforeAll(() => {
  const require = createRequire(import.meta.url);
  wasmDir = mkdtempSync(join(tmpdir(), "parse-cache-test-"));
  cpSync(grammarSource, join(wasmDir, GRAMMAR_WASM_FILENAME));
  cpSync(
    require.resolve(`web-tree-sitter/${RUNTIME_WASM_FILENAME}`),
    join(wasmDir, RUNTIME_WASM_FILENAME),
  );
});

/** A `vscode.TextDocument` stand-in with mutable `version`/`text` — same
 *  identity across edits, like a real open document. */
type FakeDocument = vscode.TextDocument & { version: number; text: string };

function fakeDocument(uri: Uri, version: number, text: string): FakeDocument {
  const doc = { uri, version, text, getText: () => doc.text } as FakeDocument;
  return doc;
}

/** A `vscode.Uri` for API calls that need the real type, not the mock's. */
function fileUri(path: string): vscode.Uri {
  return Uri.file(path) as unknown as vscode.Uri;
}

/**
 * Replace `doc`'s whole text, feeding `cache.applyChange` a full-document
 * edit first — mirrors what a real `onDidChangeTextDocument` handler does,
 * so the cached tree's `.edit()` bookkeeping matches what `getText()` returns
 * on the next `parse()` call, rather than silently desyncing (tree-sitter's
 * incremental re-parse trusts the edit history over the text unconditionally).
 */
function replaceText(
  cache: ParseCache,
  doc: FakeDocument,
  version: number,
  text: string,
): void {
  const oldText = doc.text;
  const change = {
    range: new Range(new Position(0, 0), new Position(0, oldText.length)),
    rangeOffset: 0,
    rangeLength: oldText.length,
    text,
  };
  cache.applyChange({
    document: doc,
    contentChanges: [change],
  } as unknown as vscode.TextDocumentChangeEvent);
  doc.version = version;
  doc.text = text;
}

/** `true` while `tree`'s WASM backing is still allocated — a freed tree
 *  throws reading any node's data. (A double `delete()` is silent, so this
 *  distinguishes live-vs-freed, not a delete count.) */
function isLive(tree: Tree): boolean {
  try {
    return tree.rootNode.text.length >= 0;
  } catch {
    return false;
  }
}

describe("ParseCache", () => {
  it("caches one tree per document and reuses it at the same version", async () => {
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/A.mo"), 1, "model A end A;");

    const first = await cache.parse(doc);
    const second = await cache.parse(doc);

    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("re-parses incrementally when the version changes", async () => {
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/B.mo"), 1, "model B end B;");
    const v1 = await cache.parse(doc);
    expect(v1.rootNode.hasError).toBe(false);

    replaceText(cache, doc, 2, "model B Real x; end B;");
    const v2 = await cache.parse(doc);

    expect(v2).not.toBe(v1);
    expect(v2.rootNode.hasError).toBe(false);
    expect(v2.rootNode.text).toBe(doc.text);
    expect(cache.size).toBe(1);
  });

  it("produces one tree for concurrent cold parses of the same document/version", async () => {
    // Three providers racing one edit must collapse onto a single physical
    // parse — a second `setEntry` here would free the tree the first caller
    // is still holding.
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/C.mo"), 1, "model C end C;");

    const [a, b, c] = await Promise.all([
      cache.parse(doc),
      cache.parse(doc),
      cache.parse(doc),
    ]);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(cache.size).toBe(1);
    expect(a.rootNode.text).toBe(doc.text);
  });

  it("frees every document's tree on invalidateAll()", async () => {
    const cache = new ParseCache(wasmDir);
    const first = await cache.parse(
      fakeDocument(Uri.file("/ws/E.mo"), 1, "model E end E;"),
    );
    const second = await cache.parse(
      fakeDocument(Uri.file("/ws/F.mo"), 1, "model F end F;"),
    );

    cache.invalidateAll();

    expect(cache.size).toBe(0);
    expect(isLive(first)).toBe(false);
    expect(isLive(second)).toBe(false);
    expect(cache.stats).toEqual({ turns: 0, generations: 0, borrowed: 0 });
  });

  it("does not free a tree an in-flight parse still holds as its reparse base when invalidate() races it", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/D.mo");
    const doc = fakeDocument(uri, 1, "model D end D;");
    const base = await cache.parse(doc); // now cached at version 1

    replaceText(cache, doc, 2, "model D Real x; end D;");
    // Fire the version-2 parse but don't await it directly. `parser` is
    // already initialized (from the `await` above), so `parseOnce` reaches
    // its own `await getParser()` — registering version 1's tree as the
    // borrowed old-tree base first — after exactly one microtask hop off the
    // per-key queue, and `getParser()` resolves after exactly one more. A
    // single `await Promise.resolve()` here lands after the first and before
    // the second: squarely inside the window this class's `invalidate` doc
    // describes.
    const inFlight = cache.parse(doc);
    await Promise.resolve();
    expect(isLive(base)).toBe(true); // the borrow window was actually entered

    cache.invalidate(fileUri("/ws/D.mo"));
    expect(isLive(base)).toBe(true); // still deferred — invalidate() doesn't free it directly

    await expect(inFlight).rejects.toThrow(/invalidated/);
    expect(isLive(base)).toBe(false); // freed by the turn itself, once safe
    expect(cache.size).toBe(0);
    expect(cache.stats.borrowed).toBe(0);

    // The cache is left usable afterward — not corrupted by the race.
    replaceText(cache, doc, 3, "model D Real y; end D;");
    const fresh = await cache.parse(doc);
    expect(fresh.rootNode.text).toBe(doc.text);
    expect(cache.size).toBe(1);
  });

  it("discards every turn queued for a key, not just the one running when invalidate() fires", async () => {
    // A consumed-once flag would only cancel the turn currently executing;
    // three providers can easily queue three turns behind one edit.
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/H.mo");
    const doc = fakeDocument(uri, 1, "model H end H;");
    await cache.parse(doc); // cached at version 1

    replaceText(cache, doc, 2, "model H Real x; end H;");
    const first = cache.parse(doc);
    const second = cache.parse(doc); // queued behind `first` for the same key
    await Promise.resolve();

    cache.invalidate(fileUri("/ws/H.mo"));

    await expect(first).rejects.toThrow(/invalidated/);
    await expect(second).rejects.toThrow(/invalidated/);
    expect(cache.size).toBe(0);
  });

  it("still serves a parse queued after invalidate() bumped the key", async () => {
    // The turn queued behind `cancelled` captures the generation as it stood
    // when it was called — after the bump — so it must run to completion
    // rather than inherit a cancellation meant for an earlier turn.
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/K.mo");
    const doc = fakeDocument(uri, 1, "model K end K;");
    await cache.parse(doc);

    replaceText(cache, doc, 2, "model K Real x; end K;");
    const cancelled = cache.parse(doc);
    await Promise.resolve();
    cache.invalidate(fileUri("/ws/K.mo"));
    const queued = cache.parse(doc);

    await expect(cancelled).rejects.toThrow(/invalidated/);
    expect((await queued).rootNode.text).toBe(doc.text);
    expect(cache.stats).toEqual({ turns: 0, generations: 0, borrowed: 0 });
  });

  it("does not resurrect a stale entry when invalidate() races a document's first-ever (cold) parse", async () => {
    // A cold parse has no old tree to borrow, so it's unprotected by
    // `borrowedOldTree` alone — it still needs to discard its own result
    // once `invalidate()` targets its key, or it would cache a tree for a
    // document that's already closed.
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/G.mo");
    const doc = fakeDocument(uri, 1, "model G end G;");

    const inFlight = cache.parse(doc); // cold: nothing cached for G.mo yet
    cache.invalidate(fileUri("/ws/G.mo")); // same tick — before the parse has even started

    await expect(inFlight).rejects.toThrow(/invalidated/);
    expect(cache.size).toBe(0);

    // Reopening the file gets a fresh `TextDocument` whose version again
    // starts at 1 — must not read back the discarded parse's stale tree.
    const reopened = fakeDocument(uri, 1, "model G Real z; end G;");
    const fresh = await cache.parse(reopened);
    expect(fresh.rootNode.text).toBe(reopened.text);
  });

  it("does not let an unrelated failure in one turn poison a later parse for the same key", async () => {
    // `invalidate()` bumps the generation for an in-flight turn that then
    // fails for its own, unrelated reason (a transient `getText()`/parser
    // failure) before reaching its own generation check. A consumed-once
    // flag left set by such a turn would wrongly cancel the next, unrelated
    // parse for the same key; a monotonic counter compared fresh each time
    // does not carry state across turns like that.
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/Y.mo");
    const doc = fakeDocument(uri, 1, "model Y end Y;");
    await cache.parse(doc); // cached at version 1

    replaceText(cache, doc, 2, "model Y Real x; end Y;");
    let getTextCalls = 0;
    const text = doc.text;
    doc.getText = () => {
      getTextCalls++;
      if (getTextCalls === 1) throw new Error("boom");
      return text;
    };

    const failing = cache.parse(doc);
    await Promise.resolve(); // same one-tick window as the `invalidate()` race above
    cache.invalidate(fileUri("/ws/Y.mo"));

    // The real failure propagates, not a spurious "invalidated while parsing".
    await expect(failing).rejects.toThrow("boom");

    doc.getText = () => doc.text;
    replaceText(cache, doc, 3, "model Y Real y; end Y;");
    const fresh = await cache.parse(doc);
    expect(fresh.rootNode.text).toBe(doc.text);
  });

  it("prunes a key's generation counter once nothing is left in flight for it", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/J.mo");
    const doc = fakeDocument(uri, 1, "model J end J;");
    await cache.parse(doc);

    replaceText(cache, doc, 2, "model J Real x; end J;");
    const inFlight = cache.parse(doc);
    await Promise.resolve();
    cache.invalidate(fileUri("/ws/J.mo")); // bumps J.mo's generation counter

    await expect(inFlight).rejects.toThrow(/invalidated/);

    expect(cache.stats.generations).toBe(0);
    expect(cache.stats.turns).toBe(0);
  });

  it("invalidate() on an idle (non-borrowed) entry frees it immediately", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/E.mo");
    const doc = fakeDocument(uri, 1, "model E end E;");
    await cache.parse(doc);
    expect(cache.size).toBe(1);

    cache.invalidate(fileUri("/ws/E.mo"));

    expect(cache.size).toBe(0);
  });

  it("invalidate() on a document with nothing cached is a no-op", () => {
    const cache = new ParseCache(wasmDir);
    expect(() => cache.invalidate(fileUri("/ws/missing.mo"))).not.toThrow();
    expect(cache.size).toBe(0);
  });

  it("dispose() defers freeing a borrowed tree instead of racing an in-flight parse", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/F.mo");
    const doc = fakeDocument(uri, 1, "model F end F;");
    const base = await cache.parse(doc);

    replaceText(cache, doc, 2, "model F Real x; end F;");
    // Same one-tick reasoning as the `invalidate()` race above.
    const inFlight = cache.parse(doc);
    await Promise.resolve();
    expect(isLive(base)).toBe(true);

    cache.dispose();
    expect(isLive(base)).toBe(true); // dispose() also defers, not frees, a borrowed tree

    await expect(inFlight).rejects.toThrow(/invalidated/);
    expect(isLive(base)).toBe(false);
    expect(cache.stats.borrowed).toBe(0);
  });

  it("rejects a parse() called after dispose() rather than racing the freed parser", async () => {
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/I.mo"), 1, "model I end I;");
    await cache.parse(doc);

    cache.dispose();

    await expect(cache.parse(doc)).rejects.toThrow(/disposed/);
  });
});
