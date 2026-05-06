import type { z } from "zod";

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
