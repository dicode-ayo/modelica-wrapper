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

import { beforeAll, describe, expect, it } from "vitest";

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

/** A mutable stand-in for `vscode.TextDocument`: same identity across edits,
 *  like a real open document, with `version`/`getText()` read live. */
interface FakeDocument {
  readonly uri: Uri;
  version: number;
  text: string;
  getText(): string;
}

function fakeDocument(uri: Uri, version: number, text: string): FakeDocument {
  return {
    uri,
    version,
    text,
    getText() {
      return this.text;
    },
  };
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
    document: doc as never,
    contentChanges: [change],
  } as never);
  doc.version = version;
  doc.text = text;
}

describe("ParseCache", () => {
  it("caches one tree per document and reuses it at the same version", async () => {
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/A.mo"), 1, "model A end A;");

    const first = await cache.parse(doc as never);
    const second = await cache.parse(doc as never);

    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("re-parses incrementally when the version changes", async () => {
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/B.mo"), 1, "model B end B;");
    const v1 = await cache.parse(doc as never);
    expect(v1.rootNode.hasError).toBe(false);

    replaceText(cache, doc, 2, "model B Real x; end B;");
    const v2 = await cache.parse(doc as never);

    expect(v2).not.toBe(v1);
    expect(v2.rootNode.hasError).toBe(false);
    expect(v2.rootNode.text).toBe(doc.text);
    expect(cache.size).toBe(1);
  });

  it("produces one tree for concurrent cold parses of the same document/version", async () => {
    // Before the per-key `turns` queue, each of these would independently
    // miss the cache, parse, and `setEntry` — the second/third call freeing
    // the tree the first is still holding, via `setEntry`'s
    // prior.tree !== entry.tree eviction.
    const cache = new ParseCache(wasmDir);
    const doc = fakeDocument(Uri.file("/ws/C.mo"), 1, "model C end C;");

    const [a, b, c] = await Promise.all([
      cache.parse(doc as never),
      cache.parse(doc as never),
      cache.parse(doc as never),
    ]);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(cache.size).toBe(1);
    // The tree is still alive and readable — a real use-after-free would
    // throw or return garbage from a WASM-backed accessor like this one.
    expect(a.rootNode.text).toBe(doc.text);
  });

  it("does not free a tree an in-flight parse still holds as its reparse base when invalidate() races it", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/D.mo");
    const doc = fakeDocument(uri, 1, "model D end D;");
    await cache.parse(doc as never); // now cached at version 1

    doc.version = 2;
    doc.text = "model D Real x; end D;";
    // Fire the version-2 parse but don't await it directly. `parser` is
    // already initialized (from the `await` above), so `parseOnce` reaches
    // its own `await getParser()` — registering version 1's tree as the
    // borrowed old-tree base first — after exactly one microtask hop off the
    // per-key queue, and `getParser()` resolves after exactly one more. A
    // single `await Promise.resolve()` here lands after the first and before
    // the second: squarely inside the window this class's `invalidate` doc
    // describes.
    const inFlight = cache.parse(doc as never);
    await Promise.resolve();
    // Before the borrow guard, `invalidate` would free the tree here — while
    // `parseOnce`, resuming next, still means to read it as `parser.parse`'s
    // incremental-reparse base.
    cache.invalidate(uri as never);

    // The in-flight parse discards its own result rather than resurrect an
    // invalidated document's cache entry — but critically, nothing throws
    // from freed-memory access; the rejection is this class's own, clean one.
    await expect(inFlight).rejects.toThrow(/invalidated/);
    expect(cache.size).toBe(0);

    // The cache is left usable afterward — not corrupted by the race.
    doc.version = 3;
    doc.text = "model D Real y; end D;";
    const fresh = await cache.parse(doc as never);
    expect(fresh.rootNode.text).toBe(doc.text);
    expect(cache.size).toBe(1);
  });

  it("invalidate() on an idle (non-borrowed) entry frees it immediately, as before", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/E.mo");
    const doc = fakeDocument(uri, 1, "model E end E;");
    await cache.parse(doc as never);
    expect(cache.size).toBe(1);

    cache.invalidate(uri as never);

    expect(cache.size).toBe(0);
  });

  it("invalidate() on a document with nothing cached is a no-op", () => {
    const cache = new ParseCache(wasmDir);
    expect(() =>
      cache.invalidate(Uri.file("/ws/missing.mo") as never),
    ).not.toThrow();
    expect(cache.size).toBe(0);
  });

  it("dispose() defers freeing a borrowed tree instead of racing an in-flight parse", async () => {
    const cache = new ParseCache(wasmDir);
    const uri = Uri.file("/ws/F.mo");
    const doc = fakeDocument(uri, 1, "model F end F;");
    await cache.parse(doc as never);

    doc.version = 2;
    doc.text = "model F Real x; end F;";
    // Same one-tick reasoning as the `invalidate()` race above.
    const inFlight = cache.parse(doc as never);
    await Promise.resolve();
    cache.dispose();

    await expect(inFlight).rejects.toThrow(/invalidated/);
  });
});
