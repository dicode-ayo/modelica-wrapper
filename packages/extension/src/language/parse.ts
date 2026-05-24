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
  })();
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

  constructor(private readonly wasmDir: string) {}

  private async getParser(): Promise<Parser> {
    if (this.parser) return this.parser;
    const language = await ensureLanguage(this.wasmDir);
    const parser = new Parser();
    parser.setLanguage(language);
    this.parser = parser;
    return parser;
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
  }

  private setEntry(key: string, entry: CacheEntry): void {
    const prior = this.entries.get(key);
    if (prior && prior.tree !== entry.tree) prior.tree.delete();
    this.entries.set(key, entry);
  }
}

/**
 * Convert a VSCode content change into a tree-sitter {@link Edit}. VSCode hands
 * us the replaced `range` (old offsets/positions) and the inserted `text`; we
 * compute the new end from the inserted text's shape.
 */
function toTreeEdit(change: vscode.TextDocumentContentChangeEvent): Edit {
  const startIndex = change.rangeOffset;
  const oldEndIndex = change.rangeOffset + change.rangeLength;
  const newEndIndex = change.rangeOffset + change.text.length;

  const startPosition = pointOf(change.range.start);
  const oldEndPosition = pointOf(change.range.end);
  const newEndPosition = advancePoint(change.range.start, change.text);

  return {
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition,
    oldEndPosition,
    newEndPosition,
  };
}

/** VSCode `Position` (0-based) → tree-sitter `Point` (0-based row/column). */
function pointOf(position: vscode.Position): Edit["startPosition"] {
  return { row: position.line, column: position.character };
}

/**
 * The point reached by inserting `text` starting at `start`. A newline resets
 * the column and advances the row; otherwise the column grows by the trailing
 * line's length.
 */
function advancePoint(
  start: vscode.Position,
  text: string,
): Edit["newEndPosition"] {
  let row = start.line;
  let column = start.character;
  for (const ch of text) {
    if (ch === "\n") {
      row += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { row, column };
}
