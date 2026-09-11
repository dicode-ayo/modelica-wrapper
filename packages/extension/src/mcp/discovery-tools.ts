/**
 * The escape hatch: the ~170 registry functions the curated set leaves out,
 * reachable on demand rather than published.
 *
 * This is deliberately something OMEdit declined to ship, and what makes it
 * defensible here is that it is not arbitrary scripting. `invoke()` validates
 * against the per-function zod schema, the `MutationEntry` table still
 * classifies the call and drives invalidation, and a mutating call still
 * derives a `WriteVerdict`. `repl.execute` — a raw command string with none of
 * that — is what this is not.
 *
 * Listings are category-scoped because a flat one is not viable inline: the
 * 202 names alone run ~1,000 tokens, and with one-line descriptions ~5,800.
 * A category ranges from ~200 tokens (`solver`) to ~1,800 (`contents`).
 *
 * `omc_invoke` is annotated as mutating. It is read-only or mutating depending
 * on `fn`, MCP annotations are per-tool rather than per-call, and the honest
 * static answer for a tool that can mutate is that it mutates. The per-call
 * truth stays where it lives for every other tool — the `MutationEntry` table.
 */

import {
  describeFunctionAsJsonSchema,
  functionsByCategory,
  omcFunctionNames,
  renderCategoryHelp,
  renderOverview,
  type OmcFnName,
} from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  dispatch,
  errorResult,
  textResult,
  type McpToolDeps,
} from "./dispatch.js";

const ListFunctionsSchema = z.object({
  category: z
    .string()
    .optional()
    .describe(
      "Category to list. Omit for the category overview with per-category counts.",
    ),
});

const DescribeFunctionSchema = z.object({
  name: z
    .string()
    .describe("OMC function name, as omc_list_functions spells it."),
});

const InvokeSchema = z.object({
  fn: z
    .string()
    .describe("OMC function name, as omc_list_functions spells it."),
  input: z
    .record(z.string(), z.unknown())
    .describe(
      "Named arguments, matching the input schema omc_describe_function returns.",
    ),
});

function isOmcFnName(name: string): name is OmcFnName {
  return (omcFunctionNames as readonly string[]).includes(name);
}

/** The refusal for a name the registry does not hold, naming its neighbours. */
function unknownFunction(name: string): string {
  const close = omcFunctionNames
    .filter((n) => n.toLowerCase().includes(name.toLowerCase()))
    .slice(0, 10);
  const hint =
    close.length > 0
      ? `Did you mean: ${close.join(", ")}?`
      : "Use omc_list_functions to find it.";
  return `No OMC function named ${name}. ${hint}`;
}

export function registerDiscoveryTools(
  server: McpServer,
  deps: McpToolDeps,
): void {
  server.registerTool(
    "omc_list_functions",
    {
      description:
        "List the OMC scripting functions reachable through omc_invoke, by category. Omit `category` for the overview.",
      inputSchema: ListFunctionsSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ category }: z.infer<typeof ListFunctionsSchema>) => {
      if (category === undefined) return textResult(renderOverview());
      const help = renderCategoryHelp(category);
      if (help !== undefined) return textResult(help);
      const known = Object.keys(functionsByCategory()).sort().join(", ");
      return errorResult(`No category named ${category}. Known: ${known}.`);
    },
  );

  server.registerTool(
    "omc_describe_function",
    {
      description:
        "Return one OMC function's category, description, and JSON Schema for its arguments.",
      inputSchema: DescribeFunctionSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ name }: z.infer<typeof DescribeFunctionSchema>) => {
      if (!isOmcFnName(name)) return errorResult(unknownFunction(name));
      // Input only: the output side of `getModelInstance` and
      // `getModelInstanceAnnotation` carries a `.transform()` with no JSON
      // Schema equivalent, and it is not what a caller needs to make the call.
      const { category, description, input } =
        describeFunctionAsJsonSchema(name);
      return textResult(
        JSON.stringify({ name, category, description, input }, null, 2),
      );
    },
  );

  server.registerTool(
    "omc_invoke",
    {
      description:
        "Call any OMC scripting function by name with named arguments, validated against its schema. Use omc_describe_function first for the argument shape.",
      inputSchema: InvokeSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ fn, input }: z.infer<typeof InvokeSchema>) =>
      isOmcFnName(fn)
        ? dispatch(deps, fn, input)
        : errorResult(unknownFunction(fn)),
  );
}
