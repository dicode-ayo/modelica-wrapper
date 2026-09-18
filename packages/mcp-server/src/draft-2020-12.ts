/**
 * The draft a published schema declares.
 *
 * The SDK's converter emits draft-07 and takes no option to emit anything
 * else, so every published schema declares
 * `http://json-schema.org/draft-07/schema#`. A client holding tool definitions
 * to draft 2020-12 refuses that declaration whatever the schema below it says
 * — and one request carries every tool, so the refusal takes the whole set
 * down rather than the tool it names.
 *
 * Every published structure is spelled the same way in both drafts —
 * `boundedArray` keeps the one construct that is not — so the declaration is
 * the only thing the converter gets wrong.
 */

import { z } from "zod";

export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/**
 * `schema` published as draft 2020-12.
 *
 * The converter writes the target's own `$schema` before copying registry
 * metadata over it, which is what lets this override rather than be ignored.
 *
 * The metadata replaces whatever was registered before rather than merging
 * with it, so the rest of it is carried across here. A registry entry is keyed
 * by the schema object, and the curated tools share theirs with
 * `describeFunctionInputAsJsonSchema` — whatever is registered here reaches
 * that output too.
 */
export function atDraft2020_12<T extends z.ZodType>(schema: T): T {
  z.globalRegistry.add(schema, {
    ...z.globalRegistry.get(schema),
    $schema: DRAFT_2020_12,
  });
  return schema;
}
