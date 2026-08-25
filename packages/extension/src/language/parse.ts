/**
 * tree-sitter parse layer for Modelica source.
 *
 * Two responsibilities:
 *
 *   1. **Init the parser once** (lazy singleton). `web-tree-sitter` runs the
 *      grammar as WASM in-process, so there's no native rebuild per platform.
 *      Init needs two `.wasm` files shipped beside the bundle (see
 *      `esbuild.config.mjs`): the runtime core (`tree-sitter.wasm`) and the
 *      grammar (`tree-sitter-modelica.wasm`, fetched on install — see
 *      `grammar/README.md`).
 *
 *   2. **Cache one `Tree` per `uri + version`** and re-parse incrementally
 *      when a document changes. tree-sitter's `Tree.edit` + re-parse with the
 *      old tree is far cheaper than a full re-parse, so we feed it the text
 *      delta from each `TextDocumentContentChangeEvent`.
 *
 * Everything that classifies a position lives in `cursor.ts` (pure); this
 * file only owns the parser lifecycle and the cache.
 */

import * as path from "node:path";

import * as vscode from "vscode";

import {
  Language,
  Parser,
  type Edit,
  type Point,
  type Tree,
} from "web-tree-sitter";

import { log } from "../logger.js";
import { advancePointUtf16 } from "./position.js";

/**
 * Filenames of the two WASM assets copied into `out/` by `esbuild.config.mjs`.
 * Keep these in sync with the `wasmAssets` table there.
 */
export const RUNTIME_WASM_FILENAME = "tree-sitter.wasm";
export const GRAMMAR_WASM_FILENAME = "tree-sitter-modelica.wasm";

/** The VSCode language id contributed in `package.json` (`contributes.languages`). */
export const MODELICA_LANGUAGE_ID = "modelica";

/**
 * A {@link vscode.DocumentSelector} that binds language providers (added in
 * later PRs) to Modelica buffers — both real files and the in-memory
 * `modelica-source:` scheme the diagram editor uses.
 */
export const MODELICA_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { language: MODELICA_LANGUAGE_ID },
];

let languagePromise: Promise<Language> | undefined;

/**
 * Initialize the WASM runtime + load the Modelica grammar exactly once.
 *
 * `wasmDir` is the directory the two `.wasm` files were copied into — at
 * runtime that's `<extension>/out`, derivable from
 * `vscode.ExtensionContext.extensionUri`. The runtime core is located via
 * Emscripten's `locateFile`; the grammar is loaded by absolute path.
 */
export async function ensureLanguage(wasmDir: string): Promise<Language> {
  if (languagePromise) return languagePromise;
  languagePromise = (async () => {
    const runtimeWasm = path.join(wasmDir, RUNTIME_WASM_FILENAME);
    const grammarWasm = path.join(wasmDir, GRAMMAR_WASM_FILENAME);
    await Parser.init({
      // Point Emscripten at the bundled runtime WASM instead of letting it
      // guess a URL — we run in the Node extension host, not a browser.
      locateFile: (file: string) =>
        file === RUNTIME_WASM_FILENAME ? runtimeWasm : file,
    });
    const language = await Language.load(grammarWasm);
    log.info(
      "language.parse",
      `tree-sitter-modelica loaded (ABI ${language.version})`,
    );
    return language;
  })().catch((err: unknown) => {
    // Don't poison the singleton on a transient init failure (missing/corrupt
    // WASM, a failed `Parser.init`). Clearing the cached promise lets the next
    // `ensureLanguage` re-attempt instead of replaying the same rejection
    // forever — which previously needed a window reload to escape.
    languagePromise = undefined;
    throw err;
  });
  return languagePromise;
}

/**
 * A parsed buffer plus the metadata needed to know when the cache entry is
 * stale and to drive an incremental re-parse.
 */
interface CacheEntry {
  readonly version: number;
  readonly tree: Tree;
}

/**
 * Owns the parser + a per-document `Tree` cache. One instance per extension
 * activation; created in `index.ts` and disposed on deactivate.
 *
 * `parse()` calls for the same document are serialized through a per-key
 * queue (`turns`) rather than run independently: without it, several
 * providers racing the same edit (document-symbols, semantic-tokens,
 * completion) would each miss the cache, each parse, and each `setEntry` —
 * the second caller freeing the tree the first is still walking, since
 * `Tree.delete()` frees WASM-backed memory the tree-sitter binding gives no
 * safe way to detect use of afterward. Serializing collapses them onto one
 * physical parse: a later turn's own cache check (`entries.get(key)`) picks
 * up whatever the previous turn just stored.
 *
 * That serialization alone still leaves a gap: the old tree a turn passes to
 * `parser.parse()` for an incremental re-parse is read (and cached-entry
 * bookkeeping is written) across an `await` on `getParser()`, so
 * `invalidate()`/`dispose()` — both synchronous, both reachable from outside
 * any turn (`onDidCloseTextDocument`, the invalidation registry) — could
 * still free that exact tree in the gap before `parser.parse()` reads it.
 * `borrowedOldTree` records which tree a key's current turn is about to hand
 * to `parser.parse()`, from before the await; `invalidate`/`dispose` check it
 * and defer freeing a tree that's still borrowed instead of racing it. More
 * generally, ANY key with an outstanding `turns` entry — including a
 * document's first-ever (cold) parse, which has no old tree to borrow — gets
 * marked in `invalidatedWhileInFlight`: without this, a cold parse racing a
 * close/dispose would finish after the fact and `setEntry` a tree for a
 * document that's no longer current, silently poisoning a later `parse()` for
 * the same key (e.g. the file reopened, its version counter restarted at 1).
 * Either way the in-flight turn discards its own result and frees what it
 * borrowed, once `parser.parse()` is done reading it. `dispose()` additionally
 * waits out every outstanding turn before freeing the shared `Parser` itself,
 * for the same reason.
 */
export class ParseCache implements vscode.Disposable {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly turns = new Map<string, Promise<unknown>>();
  private readonly borrowedOldTree = new Map<string, Tree>();
  private readonly invalidatedWhileInFlight = new Set<string>();
  private parser: Parser | undefined;
  private parserPromise: Promise<Parser> | undefined;

  constructor(private readonly wasmDir: string) {}

  private getParser(): Promise<Parser> {
    if (this.parser) return Promise.resolve(this.parser);
    // Memoize the in-flight init so two concurrent first `parse()` calls share
    // one `Parser`. Without this both pass the `this.parser` guard, both
    // `new Parser()`, and the first one is orphaned (never `.delete()`-ed — a
    // small WASM-memory leak). On failure we clear the promise so a retry can
    // re-init (mirrors `ensureLanguage`).
    this.parserPromise ??= (async () => {
      const language = await ensureLanguage(this.wasmDir);
      const parser = new Parser();
      parser.setLanguage(language);
      this.parser = parser;
      return parser;
    })().catch((err: unknown) => {
      this.parserPromise = undefined;
      throw err;
    });
    return this.parserPromise;
  }

  /**
   * Parse `document`, reusing the cached tree when the version matches and
   * re-parsing incrementally (against the prior tree) otherwise. The returned
   * tree is owned by the cache — callers must not `delete()` it, and must
   * finish reading it before their next `await` (see the class doc).
   *
   * A cache hit returns synchronously-fast, without touching the per-key
   * queue. A miss joins `turns`: if another `parse()` for the same document is
   * already queued or running, this call rides behind it and then re-checks
   * the cache — usually finding the prior turn already produced a tree at
   * (whatever is by then) the current version, rather than parsing again.
   */
  async parse(document: vscode.TextDocument): Promise<Tree> {
    const key = document.uri.toString();
    const cached = this.entries.get(key);
    if (cached && cached.version === document.version) {
      return cached.tree;
    }

    const previousTurn = this.turns.get(key) ?? Promise.resolve();
    const turn = previousTurn.then(() => this.parseOnce(document, key));
    // A rejected turn must not wedge later ones queued behind it — each
    // caller still observes its own `turn`'s outcome via the `return` below.
    const wrapped = turn.catch(() => undefined);
    this.turns.set(key, wrapped);
    // Once settled, drop the queue entry so it doesn't outlive every parse
    // that ever touched this key — but only if nothing queued behind us has
    // already replaced it.
    void wrapped.then(() => {
      if (this.turns.get(key) === wrapped) this.turns.delete(key);
    });
    return turn;
  }

  private async parseOnce(
    document: vscode.TextDocument,
    key: string,
  ): Promise<Tree> {
    const cached = this.entries.get(key);
    if (cached && cached.version === document.version) {
      return cached.tree;
    }

    // Register the borrow before the only `await` below, synchronously with
    // reading `cached` — so a concurrent `invalidate()`/`dispose()` can never
    // observe this key's old tree as unborrowed while this turn still means
    // to hand it to `parser.parse()`.
    const oldTree = cached?.tree;
    if (oldTree) this.borrowedOldTree.set(key, oldTree);
    try {
      const parser = await this.getParser();
      const text = document.getText();
      // `oldTree` was already `edit()`-ed by `applyChange` for the changes
      // since it was parsed, so passing it here yields an incremental
      // re-parse.
      const tree = parser.parse(text, oldTree ?? null);
      this.borrowedOldTree.delete(key);
      if (!tree) {
        throw new Error("tree-sitter returned no tree (no language assigned?)");
      }
      if (this.invalidatedWhileInFlight.delete(key)) {
        // `invalidate()`/`dispose()` ran for this key while we were still in
        // flight and deferred to us (see `invalidate`) — safe now that
        // `parser.parse()` is done reading whatever we borrowed. The document
        // this parse was for no longer has a cache entry to update, so
        // there's nothing to store the fresh tree in either.
        oldTree?.delete();
        tree.delete();
        throw new Error(`ParseCache: ${key} was invalidated while parsing`);
      }
      this.setEntry(key, { version: document.version, tree });
      return tree;
    } finally {
      this.borrowedOldTree.delete(key);
    }
  }

  /**
   * Apply a document change to the cached tree so the *next* {@link parse}
   * call can re-parse incrementally. Cheap and synchronous — call it from the
   * `onDidChangeTextDocument` handler. If nothing is cached yet, it's a no-op.
   */
  applyChange(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    const cached = this.entries.get(key);
    if (!cached) return;
    // VSCode's `change` offsets/columns and tree-sitter's string-input space are
    // both UTF-16 code units (see `position.ts`), so they feed straight through
    // — no transcoding. VSCode pre-sorts a multi-edit batch into reverse
    // document order so that applying the changes in the order delivered keeps
    // each later (lower-offset) edit's coordinates valid against the running
    // tree — load-bearing assumption documented in the VSCode API:
    //   https://code.visualstudio.com/api/references/vscode-api#TextDocumentContentChangeEvent
    for (const change of event.contentChanges) {
      cached.tree.edit(toTreeEdit(change));
    }
  }

  /** Drop a single document's cache entry, freeing its tree. */
  invalidate(uri: vscode.Uri): void {
    const key = uri.toString();
    const cached = this.entries.get(key);
    this.entries.delete(key);
    if (this.turns.has(key)) {
      // A `parseOnce` for this key is somewhere between queued and settled —
      // it may still mean to hand `cached?.tree` to `parser.parse()` as its
      // reparse base (if borrowed, handled below), or it may simply be a cold
      // parse about to cache a tree for a document that's no longer current
      // either way. Defer to it: it discards its own result once it notices
      // (see `parseOnce`).
      this.invalidatedWhileInFlight.add(key);
    }
    if (!cached) return;
    if (this.borrowedOldTree.get(key) === cached.tree) {
      // Freeing this tree now would race `parser.parse()`'s read of it.
      return;
    }
    cached.tree.delete();
  }

  /** Number of cached trees — for tests/diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const [key, entry] of this.entries) {
      if (this.borrowedOldTree.get(key) === entry.tree) {
        continue;
      }
      entry.tree.delete();
    }
    this.entries.clear();
    // Any key still mid-flight — cold parses included — discards its own
    // result instead of caching into a cache nobody will read again; see
    // `invalidate`.
    for (const key of this.turns.keys()) this.invalidatedWhileInFlight.add(key);

    // A key with an outstanding `turns` entry has a `parseOnce` call
    // somewhere between being queued and fully settled — including the
    // window where it holds `this.parser` to call `parser.parse()` on.
    // Freeing the parser out from under that call would be a use-after-free
    // on the parser itself, not just a tree, so deleting it waits for every
    // outstanding turn to settle rather than racing them.
    const outstanding = [...this.turns.values()];
    if (outstanding.length === 0) {
      this.deleteParser();
      return;
    }
    void Promise.allSettled(outstanding).then(() => this.deleteParser());
  }

  private deleteParser(): void {
    this.parser?.delete();
    this.parser = undefined;
    this.parserPromise = undefined;
  }

  private setEntry(key: string, entry: CacheEntry): void {
    const prior = this.entries.get(key);
    if (prior && prior.tree !== entry.tree) prior.tree.delete();
    this.entries.set(key, entry);
  }
}

/**
 * Convert a VSCode content change into a tree-sitter {@link Edit}.
 *
 * VSCode's offsets/columns and tree-sitter's string-input space are **both
 * UTF-16 code units** (see `position.ts`), so `rangeOffset`, `rangeLength`,
 * `text.length` and `Position.character` feed straight through with no
 * transcoding. The only care needed is the *new* end position's column, which
 * must count UTF-16 code units of the inserted text (not code points) so astral
 * characters land correctly — handled by {@link advancePointUtf16}.
 */
function toTreeEdit(change: vscode.TextDocumentContentChangeEvent): Edit {
  const startIndex = change.rangeOffset;
  const oldEndIndex = change.rangeOffset + change.rangeLength;
  const newEndIndex = change.rangeOffset + change.text.length;

  const startPosition = pointOf(change.range.start);
  const oldEndPosition = pointOf(change.range.end);
  const newEndPosition = advancePointUtf16(startPosition, change.text);

  return {
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition,
    oldEndPosition,
    newEndPosition,
  };
}

/** VSCode `Position` (UTF-16 row/column) → tree-sitter `Point` (UTF-16). */
function pointOf(position: vscode.Position): Point {
  return { row: position.line, column: position.character };
}
