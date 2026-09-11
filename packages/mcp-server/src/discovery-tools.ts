/**
 * The escape hatch: the ~170 registry functions the curated set leaves out,
 * reachable on demand rather than published.
 *
 * `omc_invoke` is not arbitrary scripting the way a raw command string is.
 * `invoke()` validates against the per-function zod schema, the `MutationEntry`
 * table still classifies the call and drives invalidation, and a mutating call
 * still derives a `WriteVerdict`.
 *
 * Listings are category-scoped because a flat one is not viable inline: the
 * names alone are an order of magnitude more than the largest category, and
 * with one-line descriptions several times that again.
 *
 * `omc_invoke` is annotated as mutating because it can mutate: whether it does
 * depends on `fn`, and MCP annotations are per-tool rather than per-call. The
 * per-call answer comes from the `MutationEntry` table, as everywhere else.
 */

import {
  describeFunctionInputAsJsonSchema,
  functionsByCategory,
  isOmcFnName,
  omcFunctionNames,
  renderCategoryHelp,
  renderOverview,
  type OmcFnName,
} from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  dispatchByName,
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

const CATEGORIES = Object.keys(functionsByCategory()).sort().join(", ");
const OVERVIEW = renderOverview();
const CATEGORY_HELP = new Map<string, string | undefined>();
const INPUT_KEYS = new Map<OmcFnName, ReadonlySet<string>>();

/**
 * The argument names `fn` accepts. Memoized: the registry is frozen, so the
 * projection is a constant.
 */
function inputKeys(fn: OmcFnName): ReadonlySet<string> {
  let known = INPUT_KEYS.get(fn);
  if (known === undefined) {
    const { input } = describeFunctionInputAsJsonSchema(fn);
    known = new Set(Object.keys(input.properties ?? {}));
    INPUT_KEYS.set(fn, known);
  }
  return known;
}

/**
 * Argument names `fn` does not have.
 *
 * The input schema rejects these on its own, naming only the offending key;
 * this names the arguments the function does take.
 */
function unknownArguments(
  fn: OmcFnName,
  input: Record<string, unknown>,
): string[] {
  const known = inputKeys(fn);
  return Object.keys(input).filter((name) => !known.has(name));
}

/** The refusal for a name the registry does not hold, naming its neighbors. */
function unknownFunction(name: string): string {
  const needle = name.toLowerCase();
  const close = omcFunctionNames
    .filter((n) => n.toLowerCase().includes(needle))
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
    async ({ category }) => {
      if (category === undefined) return textResult(OVERVIEW);
      if (!CATEGORY_HELP.has(category)) {
        CATEGORY_HELP.set(category, renderCategoryHelp(category));
      }
      const help = CATEGORY_HELP.get(category);
      return help === undefined
        ? errorResult(`No category named ${category}. Known: ${CATEGORIES}.`)
        : textResult(help);
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
    async ({ name }) => {
      if (!isOmcFnName(name)) return errorResult(unknownFunction(name));
      return textResult(
        JSON.stringify(describeFunctionInputAsJsonSchema(name)),
      );
    },
  );

  server.registerTool(
    "omc_invoke",
    {
      description:
        "Call any OMC scripting function by name with named arguments, validated against its schema. Argument names are this API's, which differ from the OMC scripting docs in places (`typeName`, not `cl`) — use omc_describe_function first for the exact shape.",
      inputSchema: InvokeSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ fn, input }) => {
      if (!isOmcFnName(fn)) return errorResult(unknownFunction(fn));
      const unknown = unknownArguments(fn, input);
      if (unknown.length > 0) {
        return errorResult(
          `${fn} has no argument named ${unknown.join(", ")}. ` +
            `It takes: ${[...inputKeys(fn)].join(", ") || "(none)"}.`,
        );
      }
      return dispatchByName(deps, fn, input);
    },
  );
}
