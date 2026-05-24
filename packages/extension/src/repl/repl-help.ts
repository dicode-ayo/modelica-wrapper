/**
 * `:help` dispatcher for the REPL.
 *
 * REPL-specific bits live here:
 *   - `META_COMMANDS` — the `:help`, `:load`, `:cd`, … set the REPL adds
 *     on top of OMC's API. Mirrored in `repl-eval.ts` (single source).
 *   - Topic routing — which kind of help the user is asking for.
 *
 * Everything else (per-function rendering, category lists, the OMC API
 * overview, schema introspection) lives in `@dicode/omc-client`
 * so other consumers — CLIs, MCP-tool generation, docs site — can reuse
 * the same renderers without depending on the VSCode extension.
 */

import {
  REGISTRY,
  functionsByCategory,
  renderCategoryHelp,
  renderFunctionHelp,
  renderOverview,
  type OmcFnName,
} from "@dicode/omc-client";

/**
 * Meta-commands recognised by the REPL. Kept here (rather than in
 * `repl-eval.ts`) so the help renderer + the completion source share a
 * single source of truth.
 */
export const META_COMMANDS: ReadonlyArray<{ name: string; summary: string }> = [
  { name: ":help", summary: "Show help (`:help <category|name>` for details)" },
  { name: ":clear", summary: "Clear the terminal screen" },
  { name: ":load", summary: "Call loadFile on a path (`:load <path>`)" },
  { name: ":cd", summary: "Show or change OMC's working directory (`:cd` to print, `:cd <path>` to change)" },
  { name: ":reset", summary: "Close OMC and start a fresh subprocess" },
  { name: ":exit", summary: "Close this REPL terminal" },
];

const META_LABEL_WIDTH = 16;

/**
 * Top-level help dispatcher. Returns the text to print plus an `unknown`
 * flag (true when `arg` matched nothing — caller treats as error).
 */
export function formatHelp(arg: string | undefined): {
  output: string;
  unknown: boolean;
} {
  const a = arg?.trim() ?? "";
  if (a.length === 0) return { output: formatOverview(), unknown: false };

  // Meta-command detail. Accept the topic with or without the leading colon
  // because `:help load` reads more naturally than `:help :load`.
  const metaKey = a.startsWith(":") ? a : `:${a}`;
  const meta = META_COMMANDS.find((m) => m.name === metaKey);
  if (meta) return { output: formatMeta(meta), unknown: false };

  // Category before function-name: avoids the chance of a function name
  // collision with a category (none today, but stable against future
  // additions).
  const byCat = functionsByCategory();
  if (Object.prototype.hasOwnProperty.call(byCat, a)) {
    const out = renderCategoryHelp(a);
    if (out) return { output: out, unknown: false };
  }

  if (Object.prototype.hasOwnProperty.call(REGISTRY, a)) {
    return { output: renderFunctionHelp(a as OmcFnName), unknown: false };
  }

  return {
    output: `unknown help topic "${a}" — try :help for the overview.`,
    unknown: true,
  };
}

function formatOverview(): string {
  const lines: string[] = [];
  lines.push("Modelica REPL meta-commands:");
  for (const m of META_COMMANDS) {
    lines.push(`  ${m.name.padEnd(META_LABEL_WIDTH)}${m.summary}`);
  }
  lines.push("");
  lines.push(renderOverview());
  return lines.join("\n");
}

function formatMeta(m: { name: string; summary: string }): string {
  return `${m.name}\n  ${m.summary}`;
}
