import { log } from "../../logger.js";

import { MAX_COMPLETIONS, type CompletionCandidate } from "./candidate.js";

/**
 * Run an OMC call that may throw, log + swallow on failure, and return a
 * fallback. Used by the candidate-source helpers so each throwing call site
 * reads as one line and the "swallow + log + fallback" pattern lives in one
 * place.
 */
export async function tryCall<T>(
  label: string,
  call: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    // `log.debug` (not `warn`) — completion fires on every keystroke, so a
    // persistent OMC failure must not flood the OutputChannel.
    log.debug("language", `completion ${label} failed`, err);
    return fallback;
  }
}

/**
 * De-dupe by label (first occurrence wins, so local children rank ahead of
 * fuzzy global hits of the same name) and bound the list to
 * {@link MAX_COMPLETIONS}.
 */
export function cap(candidates: CompletionCandidate[]): CompletionCandidate[] {
  const seen = new Set<string>();
  const out: CompletionCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    out.push(c);
    if (out.length >= MAX_COMPLETIONS) break;
  }
  return out;
}
