/**
 * Describing a fixed-length tuple in a way every JSON Schema draft agrees on.
 *
 * A tuple's natural description is draft-07's `items: [...]` plus
 * `additionalItems`, which draft 2020-12 replaced with `prefixItems`. A schema
 * reaches an MCP client through the SDK's converter, which emits draft-07 and
 * takes no option to emit anything else, so a client holding tool definitions
 * to 2020-12 rejects a tuple — and since one request carries every tool, it
 * rejects the whole set rather than the one tool that contains it.
 *
 * `minItems`/`maxItems` over a uniform element type carry the same contract in
 * either draft, which is what {@link boundedArray} substitutes. It changes the
 * description only: the tuple still parses, still rejects the wrong length, and
 * still types as a tuple.
 */

import { z } from "zod";

/**
 * `schema` described as a length-bounded array of `element` rather than as a
 * tuple.
 *
 * The metadata replaces whatever `describe()` registered rather than merging
 * with it, so `description` is passed here instead.
 */
export function boundedArray<T extends z.ZodType>(
  schema: T,
  element: "number" | "string",
  length: number,
  description: string,
): T {
  z.globalRegistry.add(schema, {
    description,
    type: "array",
    items: { type: element },
    additionalItems: undefined,
    minItems: length,
    maxItems: length,
  });
  return schema;
}
