/**
 * Publishing one tool, at the draft a client holds it to.
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
 * the only thing the converter gets wrong. Every tool is registered through
 * here, so none can be published without it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/**
 * Register `name`, declaring its input schema at draft 2020-12.
 *
 * `ToolCallback` is a conditional type on the schema, and nothing is
 * assignable to one that is still generic — so the schema widens on the way to
 * the SDK and the input is re-narrowed on the way into the handler. Both casts
 * stay here: a caller infers its own argument type from the schema it passes.
 */
export function registerTool<S extends z.ZodType>(
  server: McpServer,
  name: string,
  config: {
    description: string;
    inputSchema: S;
    annotations: { readOnlyHint: boolean };
  },
  handle: (input: z.infer<S>) => Promise<CallToolResult>,
): void {
  server.registerTool(
    name,
    { ...config, inputSchema: atDraft2020_12(config.inputSchema) },
    async (input: unknown) => handle(input as z.infer<S>),
  );
}

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
function atDraft2020_12(schema: z.ZodType): z.ZodType {
  z.globalRegistry.add(schema, {
    ...z.globalRegistry.get(schema),
    $schema: DRAFT_2020_12,
  });
  return schema;
}
