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
 * `Tree.delete()` frees WASM-backed memory the tree-sitter binding has no way
 * to detect use of afterward, so two invariants matter here:
 *
 *   - `parse()` calls for one document are serialized through a per-key queue
 *     (`turns`), so two callers racing the same edit collapse onto one
 *     physical parse instead of each freeing the tree the other is walking.
 *   - A tree handed to `parser.parse()` as the incremental-reparse base is
 *     recorded in `borrowedOldTree` before the `await` that follows, so
 *     `invalidate()`/`dispose()` defer freeing it instead of racing that read.
 *
 * `generations` backs the discard half of that second bullet, and extends it
 * to a cold first parse (no old tree to borrow, so `borrowedOldTree` alone
 * wouldn't protect it from `setEntry`-ing a tree for a document that's no
 * longer current): `invalidate`/`dispose` bump a key's generation instead of
 * freeing an in-flight turn's result directly. Every turn queued for that key
 * at that point — not just the one currently running — compares its own
 * captured generation against the current one and discards its result on a
 * mismatch, freeing whatever it borrowed itself once `parser.parse()` is done
 * with it. `dispose()` additionally waits out every outstanding turn before
 * freeing the shared `Parser` itself, for the same reason, and refuses
 * further `parse()` calls once it has.
 */
export class ParseCache implements vscode.Disposable {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly turns = new Map<string, Promise<unknown>>();
  private readonly borrowedOldTree = new Map<string, Tree>();
  private readonly generations = new Map<string, number>();
  private disposed = false;
  private parser: Parser | undefined;
  private parserPromise: Promise<Parser> | undefined;

  constructor(private readonly wasmDir: string) {}

  private generationOf(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  /** Invalidate every turn queued for `key`: each compares its own captured
   *  generation against this and discards its result on a mismatch. */
  private bumpGeneration(key: string): void {
    this.generations.set(key, this.generationOf(key) + 1);
  }

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
   */
  async parse(document: vscode.TextDocument): Promise<Tree> {
    if (this.disposed) {
      throw new Error("ParseCache: disposed");
    }
    const key = document.uri.toString();
    const cached = this.entries.get(key);
    if (cached && cached.version === document.version) {
      return cached.tree;
    }

    // Captured now, not inside `parseOnce` once this turn's own wait is over
    // — an `invalidate()`/`dispose()` that bumps the generation while this
    // turn is still queued (behind another one for the same key) must still
    // be visible to it once its turn comes, not just to the turn running at
    // the moment of the bump.
    const generation = this.generationOf(key);
    const previousTurn = this.turns.get(key) ?? Promise.resolve();
    const turn = previousTurn.then(() =>
      this.parseOnce(document, key, generation),
    );
    // A rejected turn must not wedge later ones queued behind it — each
    // caller still observes its own `turn`'s outcome via the `return` below.
    const wrapped = turn.catch(() => undefined);
    this.turns.set(key, wrapped);
    // Once settled, drop the queue entry and this key's generation counter so
    // neither outlives every parse that ever touched the key — the next
    // `parse()` starts from a fresh baseline.
    void wrapped.then(() => {
      if (this.turns.get(key) !== wrapped) return;
      this.turns.delete(key);
      this.generations.delete(key);
    });
    return turn;
  }

  private async parseOnce(
    document: vscode.TextDocument,
    key: string,
    generation: number,
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
      if (!tree) {
        throw new Error("tree-sitter returned no tree (no language assigned?)");
      }
      if (this.generationOf(key) !== generation) {
        // `invalidate()`/`dispose()` bumped this key's generation while we
        // were in flight — the document this parse was for is no longer
        // current, so there's nothing to store the fresh tree in.
        tree.delete();
        throw new Error(`ParseCache: ${key} was invalidated while parsing`);
      }
      this.setEntry(key, { version: document.version, tree });
      return tree;
    } finally {
      this.borrowedOldTree.delete(key);
      // On a bump, `invalidate`/`dispose` skipped freeing `oldTree` because
      // this turn had it borrowed for `parser.parse()` to read, so freeing it
      // falls to this turn. Without a bump it is still the live `entries`
      // value: `setEntry` frees it on success, and a failure leaves it as the
      // cache's tree.
      if (oldTree && this.generationOf(key) !== generation) oldTree.delete();
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

  /** Drop a single document's cache entry, freeing its tree unless an
   *  in-flight parse still holds it as its reparse base. */
  invalidate(uri: vscode.Uri): void {
    const key = uri.toString();
    const cached = this.entries.get(key);
    this.entries.delete(key);
    // Every turn queued for this key — not just the one currently running —
    // discards its result once it notices the bump (see `parseOnce`).
    if (this.turns.has(key)) this.bumpGeneration(key);
    if (!cached) return;
    if (this.borrowedOldTree.get(key) === cached.tree) {
      // A turn still means to hand this exact tree to `parser.parse()` as
      // its reparse base — freeing it now would race that read. It frees it
      // itself, once safe (see `parseOnce`).
      return;
    }
    cached.tree.delete();
  }

  /** Number of cached trees — for tests/diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  /** Internal map sizes — for tests; `borrowed`/`turns`/`generations` must all
   *  return to zero once nothing is in flight for a key. */
  get stats(): { turns: number; generations: number; borrowed: number } {
    return {
      turns: this.turns.size,
      generations: this.generations.size,
      borrowed: this.borrowedOldTree.size,
    };
  }

  dispose(): void {
    // Reject every `parse()` from here on — otherwise one could still land
    // after this method returns, chain onto the (by-then-settled) `turns`
    // entry it read below, and race the parser teardown at the bottom.
    this.disposed = true;
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
    for (const key of this.turns.keys()) this.bumpGeneration(key);

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
