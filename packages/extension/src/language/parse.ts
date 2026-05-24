/**
 * tree-sitter parse layer for Modelica source.
 *
 * Two responsibilities:
 *
 *   1. **Init the parser once** (lazy singleton). `web-tree-sitter` runs the
 *      grammar as WASM in-process, so there's no native rebuild per platform.
 *      Init needs two `.wasm` files shipped beside the bundle (see
 *      `esbuild.config.mjs`): the runtime core (`tree-sitter.wasm`) and the
 *      vendored grammar (`tree-sitter-modelica.wasm`).
 *
 *   2. **Cache one `Tree` per `uri + version`** and re-parse incrementally
 *      when a document changes. tree-sitter's `Tree.edit` + re-parse with the
 *      old tree is far cheaper than a full re-parse, so we feed it the text
 *      delta from each `TextDocumentContentChangeEvent`.
 *
 * Everything that classifies a position lives in `cursor.ts` (pure); this
 * file only owns the parser lifecycle and the cache.
 */

import * as vscode from "vscode";

import { Language, Parser, type Edit, type Tree } from "web-tree-sitter";

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
 * Initialise the WASM runtime + load the Modelica grammar exactly once.
 *
 * `wasmDir` is the directory the two `.wasm` files were copied into — at
 * runtime that's `<extension>/out`, derivable from
 * `vscode.ExtensionContext.extensionUri`. The runtime core is located via
 * Emscripten's `locateFile`; the grammar is loaded by absolute path.
 */
export async function ensureLanguage(wasmDir: string): Promise<Language> {
  if (languagePromise) return languagePromise;
  languagePromise = (async () => {
    const path = await import("node:path");
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
 */
export class ParseCache implements vscode.Disposable {
  private readonly entries = new Map<string, CacheEntry>();
  private parser: Parser | undefined;
  private parserPromise: Promise<Parser> | undefined;

  constructor(private readonly wasmDir: string) {}

  private getParser(): Promise<Parser> {
    if (this.parser) return Promise.resolve(this.parser);
    // Memoise the in-flight init so two concurrent first `parse()` calls share
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
   * tree is owned by the cache — callers must not `delete()` it.
   */
  async parse(document: vscode.TextDocument): Promise<Tree> {
    const key = document.uri.toString();
    const cached = this.entries.get(key);
    if (cached && cached.version === document.version) {
      return cached.tree;
    }

    const parser = await this.getParser();
    const text = document.getText();
    // `cached.tree` was already `edit()`-ed by `applyChange` for the in-flight
    // changes, so passing it as the old tree yields an incremental re-parse.
    const tree = parser.parse(text, cached?.tree ?? null);
    if (!tree) {
      throw new Error("tree-sitter returned no tree (no language assigned?)");
    }
    this.setEntry(key, { version: document.version, tree });
    return tree;
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
    // — no transcoding. VSCode delivers a multi-edit batch sorted by range
    // descending, so applying the edits in the given order keeps each later
    // (lower-offset) edit's coordinates valid against the running tree.
    for (const change of event.contentChanges) {
      cached.tree.edit(toTreeEdit(change));
    }
  }

  /** Drop a single document's cache entry, freeing its tree. */
  invalidate(uri: vscode.Uri): void {
    const key = uri.toString();
    const cached = this.entries.get(key);
    if (!cached) return;
    cached.tree.delete();
    this.entries.delete(key);
  }

  /** Number of cached trees — for tests/diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.tree.delete();
    this.entries.clear();
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
function pointOf(position: vscode.Position): Edit["startPosition"] {
  return { row: position.line, column: position.character };
}
