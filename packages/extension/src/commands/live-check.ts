/**
 * Debounced per-document check pipeline.
 *
 * On every change to a `modelica-source:` document we:
 *   1. Debounce (default 750ms, `modelica.checkDebounceMs` overrides).
 *   2. Capture a generation token; if the doc changes again during the
 *      pipeline, abort silently.
 *   3. `parseString` to detect syntax errors WITHOUT mutating the OMC
 *      registry. If parsing fails, just surface those messages.
 *   4. Otherwise `loadString` the buffer into OMC, align a class that
 *      shares its file with siblings (see `shared-file-diagnostics.ts`),
 *      and run `checkModel` against the qualified name in the URI.
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
  alignToSharedFile,
  bufferOwnCoords,
  keepForBuffer,
  type SharedFileClient,
} from "../shared-file-diagnostics.js";
import {
  multiEntityMessage,
  renamedClass,
  renamedClassMessage,
  type StringParseClient,
} from "../single-entity-file.js";
import type { WriteVerdictClient } from "../write-verdict.js";
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
export interface LiveCheckClient
  extends
    FileOwnerClient,
    WriteVerdictClient,
    StringParseClient,
    SharedFileClient {
  // Both bases name `getClassInformation` for their own field; the pipeline
  // hands one client to each, so it has to satisfy them together.
  getClassInformation(input: { typeName: string }): Promise<{
    fileReadOnly: boolean;
    lineNumberStart: number;
    lineNumberEnd: number;
    columnNumberStart: number;
  }>;
  getErrorString(): Promise<{ errorString: string }>;
  checkModel(input: { typeName: string }): Promise<unknown>;
  getMessagesStringInternal(): Promise<{ messages: ErrorMessage[] }>;
}

type DocState = {
  timer?: NodeJS.Timeout;
  /** Monotonic generation counter — bumped on every change. */
  token: number;
};

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

/** A whole-buffer warning riding the diagnostic pipeline rather than a notification, so it clears itself once the condition that raised it goes away. */
function syntheticBufferMessage(
  filename: string,
  message: string,
): ErrorMessage {
  return {
    info: {
      filename,
      readonly: false,
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    message,
    kind: "scripting",
    level: "warning",
    id: 0,
  };
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

    let client: LiveCheckClient;
    try {
      client = await ctx.ensureClient();
    } catch (err) {
      log.error("liveCheck", "failed to acquire OMC client", err);
      return;
    }
    if (state.token !== capturedToken) return;

    // A class that can't be written can't legitimately be edited either, so a
    // change on its buffer is never the user's; loading one back into OMC would
    // repoint an installed library's source at this URI. The permission half is
    // gated too: VSCode refuses edits on a read-only file's buffer, so a change
    // event on one is never user-typed either.
    if (
      typeName !== undefined &&
      !(await ctx.writeVerdicts.forClass(client, typeName, "edit")).ok
    ) {
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
    let declared: string[] = [];
    try {
      ({ classNames: declared } = await client.parseString({
        data: text,
        filename,
      }));
    } catch (err) {
      log.error("liveCheck", "parseString failed", err);
    }
    if (state.token !== capturedToken) return;
    const { messages: parseMessages } =
      await client.getMessagesStringInternal();
    // A syntax error is always about the string just parsed, never a sibling's,
    // so these need no shift. Gate on every message reported, including one
    // bounded away: an out-of-range line is still a broken buffer, and loading
    // it would re-check what `parseString` already rejected.
    const hasParseError = parseMessages.some(
      (m) => m.level === "error" || m.level === "internal",
    );
    messages.push(
      ...keepForBuffer(
        parseMessages,
        filename,
        bufferOwnCoords(document.lineCount),
      ),
    );
    // `loadString` binds every class in the text to `filename`, so loading a
    // buffer that declares several would leave OMC holding a file no save can
    // write back without dropping one (#452). Such a buffer parses clean, so
    // it carries no messages of its own — publish a synthetic one rather than
    // let the set below silently clear the squiggles the user had. Riding the
    // diagnostic pipeline (not a notification) keeps it from firing per
    // keystroke, and it clears itself when the second class goes away.
    // `renamedClass` is meaningless once `declared` holds more than one name —
    // the multi-entity screen above already refuses that buffer outright.
    const renamed =
      declared.length === 1 && typeName !== undefined
        ? renamedClass(declared, typeName)
        : undefined;

    if (declared.length > 1) {
      const message = multiEntityMessage(filename, declared);
      log.warn("liveCheck", message);
      messages.push(syntheticBufferMessage(filename, message));
    } else if (typeName !== undefined && renamed !== undefined) {
      // `loadString` binds every class in the text to `filename` rather than
      // replacing what's there, so a buffer that renamed its class would load
      // as a second, unreachable class alongside the one still live under
      // `typeName` — #459's failure mode, reached here without ever saving.
      const message = renamedClassMessage(typeName, renamed);
      log.warn("liveCheck", message);
      messages.push(syntheticBufferMessage(filename, message));
    } else if (!hasParseError) {
      // Syntax-clean — load into OMC and run the semantic check.
      try {
        await client.loadString({ data: text, filename, merge: false });
      } catch (err) {
        log.error("liveCheck", "loadString failed", err);
        return;
      }
      if (state.token !== capturedToken) return;

      // The class may share its file with siblings, whose diagnostics arrive
      // under the same filename at their own positions. Put the whole file in
      // one coordinate space so the class's extent separates its diagnostics
      // from theirs, and keep the mapping back to the buffer. A memory-only
      // class was loaded under its own URI and has no siblings to confuse it
      // with. Alignment leaves OMC on the buffer whenever it does not return a
      // mapping, so the fallback below reads the coordinates OMC is actually
      // reporting in.
      let coords = bufferOwnCoords(document.lineCount);
      if (typeName !== undefined && filename !== uri.toString()) {
        try {
          coords =
            (await alignToSharedFile(client, { typeName, filename, text })) ??
            coords;
        } catch (err) {
          log.warn(
            "liveCheck",
            `could not align ${typeName} to ${filename}; a sibling's diagnostics may leak through`,
            err,
          );
        }
      }
      if (state.token !== capturedToken) return;

      if (typeName !== undefined) {
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
      const { messages: semanticMessages } =
        await client.getMessagesStringInternal();
      messages.push(...keepForBuffer(semanticMessages, filename, coords));
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
    // A message naming the URI reaches the buffer through the branch above
    // rather than the filename the stages bounded, so bound it too — nothing
    // published against this document escapes its line range.
    const grouped = mapOmcMessagesToDiagnostics(
      keepForBuffer(
        messages,
        uri.toString(),
        bufferOwnCoords(document.lineCount),
      ),
      resolver,
    );
    ctx.diagnostics.set(uri, grouped.get(uri) ?? []);
  });
}
