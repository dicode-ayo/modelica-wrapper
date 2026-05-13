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

import type { OmcClient, ErrorMessage } from "@modelica-wrapper/omc-client";

import { mapOmcMessagesToDiagnostics } from "../diagnostics/from-omc.js";
import { log } from "../logger.js";
import {
  MODELICA_SOURCE_SCHEME,
  qualifiedNameFromUri,
} from "../source-provider.js";

import { liveCheckLock } from "./check-lock.js";
import type { CommandContext } from "./context.js";

const DEFAULT_DEBOUNCE_MS = 750;
const MIN_DEBOUNCE_MS = 250;

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
    if (!e.affectsConfiguration("modelica.checkOnEdit") && !e.affectsConfiguration("modelica.checkDebounceMs")) {
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
    const filename = uri.toString();

    let client: OmcClient;
    try {
      client = await ctx.ensureClient();
    } catch (err) {
      log.error("liveCheck", "failed to acquire OMC client", err);
      return;
    }
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
    const { messages: parseMessages } = await client.getMessagesStringInternal();
    messages.push(...parseMessages);
    const hasParseError = parseMessages.some(
      (m) => m.level === "error" || m.level === "internal",
    );
    if (!hasParseError) {
      // Syntax-clean — load into OMC and run the semantic check.
      try {
        await client.loadString({ data: text, filename });
      } catch (err) {
        log.error("liveCheck", "loadString failed", err);
        return;
      }
      if (state.token !== capturedToken) return;
      const typeName = qualifiedNameFromUri(uri);
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
      const { messages: semanticMessages } =
        await client.getMessagesStringInternal();
      messages.push(...semanticMessages);
    }
    if (state.token !== capturedToken) return;
    log.info(
      "liveCheck",
      `${uri.toString()} → ${messages.length} message${messages.length === 1 ? "" : "s"}`,
    );

    // Per-file replace. Map every OMC filename back to THIS uri when it
    // matches the pseudo-name we passed to parseString/loadString; that
    // way squiggles land in the user's actual buffer. The probe in
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
    const diagsForUri = grouped.get(uri) ?? [];
    ctx.diagnostics.set(uri, diagsForUri);
  });
}

