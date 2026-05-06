import type { z } from "zod";

import { expectBool, isNull, parse, type Value } from "../parse.js";
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

/**
 * Resolve OMC's response to a mutation into a boolean success verdict.
 *
 * OMC's behavior for setters/mutations is *inconsistent* across versions:
 * some calls return `true`/`false`, others return an empty response on
 * success (notably `createClass`, `deleteClass`, `setComponentProperties`,
 * `removeComponentModifiers` and several others on OMC 1.26+).
 *
 * Strategy:
 *   - If OMC returns a bool, that's the verdict.
 *   - If OMC returns nothing (null/empty), query `getErrorString()`. An empty
 *     error buffer means success; a non-empty one means failure (and we
 *     surface the diagnostic via a thrown Error).
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
      throw new Error(`${fnName}: ${errorString}`);
    }
    return true;
  }
  const ok = expectBool(v);
  if (!ok) {
    const { errorString } = await ctx.getErrorString();
    if (errorString.length > 0) {
      throw new Error(`${fnName}: ${errorString}`);
    }
  }
  return ok;
}
