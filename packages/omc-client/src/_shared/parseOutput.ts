import type { z } from "zod";

import { OmcDiagnosticError, looksLikeError } from "../error-buffer.js";
import {
  asBool,
  expectBool,
  isNull,
  parse,
  parseLeading,
  type Value,
} from "../parse.js";
import type { CallContext } from "./callContext.js";

/**
 * Validate `data` against `schema` and return the typed value.
 *
 * On failure, throws a single error annotated with the OMC call name so the
 * mismatch is easy to localize in stack traces.
 */
export function parseOutput<T>(
  schema: z.ZodType<T>,
  data: unknown,
  cmd: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `OMC response shape mismatch for ${cmd}: ${result.error.message}`,
    );
  }
  return result.data;
}

/** Stands in when OMC failed a call and left the buffer empty. */
export const NO_REASON = "OMC gave no reason";

/**
 * OMC's reason for a call that failed without saying so in its return value,
 * or `undefined` when the buffer holds nothing that reads as a failure. A
 * warning left by a read that succeeded is not a failure, so
 * {@link looksLikeError} decides rather than mere non-emptiness.
 *
 * Reads whatever the buffer holds: the reason is this call's own only when
 * the caller cleared the buffer immediately before it, as `withErrorBuffer`
 * does.
 */
export async function failureReason(
  ctx: CallContext,
): Promise<string | undefined> {
  const { errorString } = await ctx.getErrorString();
  return looksLikeError(errorString) ? errorString.trim() : undefined;
}

/**
 * The error a wrapper throws for a read OMC failed in its return value alone
 * — `fail()`, a `-1` row count — carrying whatever reason OMC left behind.
 */
export async function readFailure(
  ctx: CallContext,
  fnName: string,
): Promise<OmcDiagnosticError> {
  const reason = (await failureReason(ctx)) ?? NO_REASON;
  return new OmcDiagnosticError(`${fnName}: ${reason}`);
}

/**
 * Resolve OMC's response to a mutation into a boolean success verdict.
 *
 * OMC's behavior for setters/mutations is *inconsistent* across versions:
 * some calls return `true`/`false`, others return an empty response on
 * success (notably `deleteClass`, `setComponentProperties`,
 * `removeComponentModifiers` and several others on OMC 1.26+).
 *
 * Strategy:
 *   - If OMC returns a bool, that's the verdict.
 *   - If OMC returns nothing (null/empty), query `getErrorString()`. An empty
 *     error buffer means success; a non-empty one means failure (and we
 *     surface the diagnostic via a thrown {@link OmcDiagnosticError}).
 *
 * The predicate here is deliberately stricter than {@link failureReason}'s
 * `looksLikeError`: any non-empty buffer counts as failure, rather than only
 * one containing the literal word "Error". `simulate`/`checkModel` are known
 * to leave a warning-only buffer behind on a call that still succeeded, but
 * whether a *mutation* can do the same (leave a warning with nothing else,
 * on a write that actually landed) is unconfirmed against live OMC — see
 * issue #723. Aligning the predicate without probing that case first risks
 * turning a successful mutation into a false failure the other direction.
 * The thrown *type* is aligned regardless: {@link OmcDiagnosticError} rather
 * than a bare `Error`, so the dispatcher's failure classification doesn't
 * depend on which of the two helpers a given wrapper happened to call.
 *
 * @param fnName the OMC function name, for error annotation
 */
export async function parseMutationSuccess(
  ctx: CallContext,
  raw: string,
  fnName: string,
): Promise<boolean> {
  const v: Value = parse(raw);
  if (isNull(v)) {
    const { errorString } = await ctx.getErrorString();
    if (errorString.length > 0) {
      throw new OmcDiagnosticError(`${fnName}: ${errorString}`);
    }
    return true;
  }
  const ok = expectBool(v);
  if (!ok) {
    const { errorString } = await ctx.getErrorString();
    if (errorString.length > 0) {
      throw new OmcDiagnosticError(`${fnName}: ${errorString}`);
    }
  }
  return ok;
}

/**
 * Non-throwing sibling of {@link parseMutationSuccess} for mutation wrappers
 * whose contract is `{ success: boolean; diagnostic?: string }` (the
 * `addComponent` shape).
 *
 * OMC's mutations emit two off-spec failure shapes that strict bool parsing
 * chokes on:
 *
 *   1. `false\nError occurred building AST` — the bool plus a trailing
 *      diagnostic line.
 *   2. `Error: <message>` — no bool at all, the whole response is prose.
 *
 * Rather than throw (which loses the bool/diagnostic split the caller wants
 * to surface in a toast / REPL transcript), this captures whatever OMC wrote
 * as `diagnostic` and reports `success: false` whenever the leading value
 * isn't a clean `true`. The canonical error story remains `getErrorString()`;
 * `diagnostic` is the best-effort inline hint.
 */
export function parseMutationDiagnostic(raw: string): {
  success: boolean;
  diagnostic?: string;
} {
  const { value, trailing } = parseLeading(raw);
  const bool = asBool(value);
  if (bool === undefined) {
    // Leading value isn't a bool — OMC returned a raw error (e.g.
    // `Error: ...`). Surface the whole response so the caller has
    // something actionable.
    return { success: false, diagnostic: raw.trim() };
  }
  return trailing.length > 0
    ? { success: bool, diagnostic: trailing }
    : { success: bool };
}
