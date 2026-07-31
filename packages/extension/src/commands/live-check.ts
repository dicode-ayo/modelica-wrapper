/**
 * Debounced per-document check pipeline.
 *
 * On every change to a `modelica-source:` document we:
 *   1. Debounce (default 750ms, `modelica.checkDebounceMs` overrides).
 *   2. Capture a generation token; if the doc changes again during the
 *      pipeline, abort silently.
 *   3. `parseString` to detect syntax errors WITHOUT mutating the OMC
 *      registry. If parsing fails, just surface those messages.
 *   4. Otherwise `loadString` the buffer into OMC and run `checkModel`
 *      against the qualified name in the URI.
 *   5. Drain `getMessagesStringInternal` and replace diagnostics for
 *      THIS URI only (so unrelated diagnostics — e.g. from the
 *      user-triggered `modelica.checkModel` — stay put).
 *
 * The pipeline yields to the user-triggered `modelica.checkModel`
 * command via a shared lock: while a button check is running, live
 * checks queue and the latest one runs when the lock releases.
 *
 * Toggle via `modelica.checkOnEdit` (default true). Both settings react
 * to `onDidChangeConfiguration`.
 */

import * as vscode from "vscode";

import type { ErrorMessage } from "@dicode/omc-client";

import { mapOmcMessagesToDiagnostics } from "../diagnostics/from-omc.js";
import type { FileOwnerClient } from "../file-owner.js";
import { log } from "../logger.js";
import {
  MODELICA_SOURCE_SCHEME,
  omcFilenameForDocument,
  qualifiedNameFromUri,
} from "../source-provider.js";

import { liveCheckLock } from "./check-lock.js";
import type { CommandContext } from "./context.js";

const DEFAULT_DEBOUNCE_MS = 750;
const MIN_DEBOUNCE_MS = 250;

/**
 * The OMC surface the check pipeline drives. `OmcClient` satisfies it.
 * `getSourceFile` comes from {@link FileOwnerClient} — the pipeline never calls
 * it itself, it hands the client to `omcFilenameForDocument`.
 */
export interface LiveCheckClient extends FileOwnerClient {
  getErrorString(): Promise<{ errorString: string }>;
  parseString(input: { data: string; filename: string }): Promise<unknown>;
  loadString(input: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<unknown>;
  checkModel(input: { typeName: string }): Promise<unknown>;
  getMessagesStringInternal(): Promise<{ messages: ErrorMessage[] }>;
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ lineNumberStart: number; lineNumberEnd: number }>;
}

type DocState = {
  timer?: NodeJS.Timeout;
  /** Monotonic generation counter — bumped on every change. */
  token: number;
};

/**
 * Drop a message reported against `filename` whose (possibly shifted) line
 * falls outside `[lowerBound, upperBound]`, and shift the survivors back to
 * buffer-relative coordinates by `shift`. A message for any other filename
 * passes through untouched.
 *
 * Defaults (`lowerBound=1`, `upperBound=documentLineCount`, `shift=0`) match
 * the buffer's own bounds — correct for a class with no real on-disk source,
 * one that starts its file, or a class whose reload OMC reports positions
 * for relative to the string just loaded rather than the file. A shared
 * file's sibling still bound to its own on-disk position reports a line
 * outside the edited class's bounds and gets dropped instead of mistaken for
 * the edited class's own.
 */
function keepWithinBuffer(
  msgs: readonly ErrorMessage[],
  filename: string,
  lowerBound: number,
  upperBound: number,
  shift: number,
): ErrorMessage[] {
  const kept: ErrorMessage[] = [];
  for (const msg of msgs) {
    // `lineStart: 0` is OMC's own "missing/synthetic location" marker (see
    // `omcToVscodePosition`) — not a real position to bound or shift.
    if (msg.info.filename !== filename || msg.info.lineStart === 0) {
      kept.push(msg);
      continue;
    }
    if (msg.info.lineStart < lowerBound || msg.info.lineStart > upperBound) {
      continue;
    }
    kept.push(
      shift === 0
        ? msg
        : {
            ...msg,
            info: {
              ...msg.info,
              lineStart: msg.info.lineStart - shift,
              lineEnd: Math.min(msg.info.lineEnd - shift, upperBound - shift),
            },
          },
    );
  }
  return kept;
}

/**
 * Subscribe to text edits on modelica-source: documents and run the
 * debounced check pipeline. Returns a disposable that unsubscribes and
 * clears pending timers.
 */
export function registerLiveCheck(ctx: CommandContext): vscode.Disposable {
  const states = new Map<string, DocState>();

  function readConfig(): { enabled: boolean; debounceMs: number } {
    const cfg = vscode.workspace.getConfiguration("modelica");
    const enabled = cfg.get<boolean>("checkOnEdit", true);
    const raw = cfg.get<number>("checkDebounceMs", DEFAULT_DEBOUNCE_MS);
    const debounceMs = Math.max(MIN_DEBOUNCE_MS, raw);
    return { enabled, debounceMs };
  }

  let { enabled, debounceMs } = readConfig();

  const sub = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!enabled) return;
    if (event.document.uri.scheme !== MODELICA_SOURCE_SCHEME) return;
    if (event.contentChanges.length === 0) return;

    const uri = event.document.uri;
    const key = uri.toString();
    const state = states.get(key) ?? { token: 0 };
    state.token++;
    if (state.timer) clearTimeout(state.timer);
    const capturedToken = state.token;
    state.timer = setTimeout(() => {
      void runCheck(ctx, event.document, capturedToken, state).catch((err) => {
        log.error("liveCheck", `pipeline failed for ${uri.toString()}`, err);
      });
    }, debounceMs);
    states.set(key, state);
  });

  const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      !e.affectsConfiguration("modelica.checkOnEdit") &&
      !e.affectsConfiguration("modelica.checkDebounceMs")
    ) {
      return;
    }
    ({ enabled, debounceMs } = readConfig());
  });

  return new vscode.Disposable(() => {
    sub.dispose();
    cfgSub.dispose();
    for (const state of states.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    states.clear();
  });
}

async function runCheck(
  ctx: CommandContext,
  document: vscode.TextDocument,
  capturedToken: number,
  state: DocState,
): Promise<void> {
  // Bail if the document already changed again.
  if (state.token !== capturedToken) return;

  // Serialize against the user-triggered Check Model command and any other
  // in-flight live check; OMC is single-threaded and our wrapper is mutex'd
  // anyway, but the lock lets us cancel cleanly when a newer edit arrives.
  await liveCheckLock.acquire(async () => {
    if (state.token !== capturedToken) return;
    const uri = document.uri;
    const text = document.getText();
    const typeName = qualifiedNameFromUri(uri);

    // A system-library class can't legitimately be edited, so a change on its
    // buffer is never the user's; loading one back into OMC would repoint an
    // installed library's source at this URI. The provider memoizes a
    // conclusive verdict, and `readFile` forced the lookup when the document
    // opened, so this costs nothing per keystroke. Origin only — a class whose
    // file is merely read-only on disk still gets checked, and fails at save.
    if (
      typeName !== undefined &&
      (await ctx.sourceProvider.isReadOnly(typeName))
    ) {
      return;
    }
    if (state.token !== capturedToken) return;

    let client: LiveCheckClient;
    try {
      client = await ctx.ensureClient();
    } catch (err) {
      log.error("liveCheck", "failed to acquire OMC client", err);
      return;
    }
    if (state.token !== capturedToken) return;

    // Check under the class's real source file, not its `modelica-source:` URI:
    // `loadString` binds a class to the filename it is given, so the URI would
    // evict an inline member from the `package.mo` it shares with its siblings.
    // A memory-only class has no disk path and keeps the URI. Resolved before
    // the drain below, so a failed lookup's message doesn't reach this run's
    // diagnostics.
    const filename = await omcFilenameForDocument(client, uri);
    if (state.token !== capturedToken) return;

    // Drain pre-existing diagnostics so what we read after parseString /
    // checkModel reflects this run only. Both `getErrorString` and
    // `getMessagesStringInternal` are destructive reads — they clear OMC's
    // message buffer on call. We rely on `getMessagesStringInternal` as the
    // single read point per stage so the structured records survive.
    await client.getErrorString();
    if (state.token !== capturedToken) return;

    // Syntax-only check first — `parseString` does NOT mutate the loaded
    // AST, so we can use it to detect malformed buffers without disturbing
    // OMC's state. Read the structured messages directly; do NOT call
    // `getErrorString` between parseString and the read, or the buffer
    // is drained before `getMessagesStringInternal` can see it.
    const messages: ErrorMessage[] = [];
    try {
      await client.parseString({ data: text, filename });
    } catch (err) {
      log.error("liveCheck", "parseString failed", err);
    }
    if (state.token !== capturedToken) return;
    const { messages: parseMessages } =
      await client.getMessagesStringInternal();
    // Gate on every message parseString reported: an out-of-range one is
    // still a syntax error, and skipping straight to `loadString` would
    // double-check a buffer `parseString` already found broken.
    const hasParseError = parseMessages.some(
      (m) => m.level === "error" || m.level === "internal",
    );
    // A syntax error is always about the string just parsed — never a
    // sibling's — so only the buffer-bounds check applies here, no shift.
    messages.push(
      ...keepWithinBuffer(parseMessages, filename, 1, document.lineCount, 0),
    );
    if (!hasParseError) {
      // Syntax-clean — load into OMC and run the semantic check.
      try {
        await client.loadString({ data: text, filename, merge: false });
      } catch (err) {
        log.error("liveCheck", "loadString failed", err);
        return;
      }
      if (state.token !== capturedToken) return;

      // A class stored inline in a shared file keeps its siblings loaded
      // under that same filename, so `checkModel` can report a diagnostic
      // against one of them, at their own on-disk position. Asking OMC where
      // it now believes *this* class sits — after the `loadString` above,
      // not before — gives the authoritative bounds for the class's own
      // diagnostics either way: whether OMC reports them relative to the
      // string just loaded (bounds come back ~`[1, N]`, matching the
      // buffer, and this is a no-op) or relative to the file (bounds mirror
      // the class's real position, and this is the fix). A failed or
      // implausible lookup falls back to the buffer's own bounds, same as
      // a class with no real on-disk source.
      let lowerBound = 1;
      let upperBound = document.lineCount;
      let shift = 0;
      if (typeName !== undefined && filename !== uri.toString()) {
        try {
          const info = await client.getClassInformation({ typeName });
          if (
            info.lineNumberStart >= 1 &&
            info.lineNumberEnd >= info.lineNumberStart
          ) {
            lowerBound = info.lineNumberStart;
            upperBound = info.lineNumberEnd;
            shift = info.lineNumberStart - 1;
          }
        } catch (err) {
          log.warn(
            "liveCheck",
            `getClassInformation(${typeName}) failed; a sibling's diagnostics may leak through`,
            err,
          );
        }
      }
      if (state.token !== capturedToken) return;

      if (typeName) {
        try {
          await client.checkModel({ typeName });
        } catch (err) {
          // Continue — checkModel sometimes throws on broken-but-loadable
          // sources; the diagnostics buffer will still have the details.
          log.warn(
            "liveCheck",
            `checkModel(${typeName}) raised; collecting diagnostics anyway`,
            err,
          );
        }
      }
      if (state.token !== capturedToken) return;
      const { messages: rawSemanticMessages } =
        await client.getMessagesStringInternal();
      messages.push(
        ...keepWithinBuffer(
          rawSemanticMessages,
          filename,
          lowerBound,
          upperBound,
          shift,
        ),
      );
    }
    if (state.token !== capturedToken) return;
    log.info(
      "liveCheck",
      `${uri.toString()} → ${messages.length} message${messages.length === 1 ? "" : "s"}`,
    );

    // Per-file replace. Map every OMC filename back to THIS uri when it
    // matches the name we checked under, so squiggles land in the user's
    // buffer rather than the file it happens to be stored in. The probe in
    // `lsp-probe.integration.test.ts` (Probe 2b) confirms OMC echoes a
    // `modelica-source:` URI verbatim, but as belt-and-suspenders the
    // resolver also parses any modelica-source: URI string OMC might emit
    // (in case a future OMC version normalizes the path).
    const resolver = (name: string): vscode.Uri | undefined => {
      if (name === filename) return uri;
      if (name.startsWith(`${MODELICA_SOURCE_SCHEME}:`)) {
        try {
          return vscode.Uri.parse(name);
        } catch {
          return undefined;
        }
      }
      return undefined;
    };
    const grouped = mapOmcMessagesToDiagnostics(messages, resolver);
    ctx.diagnostics.set(uri, grouped.get(uri) ?? []);
  });
}
