/**
 * Reading a simulation result for what a model checks it against, rather than
 * for the whole waveform. The read itself is `readSimulationResult`'s, so the
 * gate, the logging and the failure handling are that tool's too.
 */

import { ReadSimulationResultInputSchema } from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  errorResult,
  invoke,
  textResult,
  type McpToolDeps,
} from "./dispatch.js";
import { registerTool } from "./register-tool.js";
import { resultMatrix, summarizeResult } from "./result-summary.js";

const MAX_POINTS = 1000;

const { filename, variables } = ReadSimulationResultInputSchema.shape;

const SummarizeSimulationResultSchema = z.strictObject({
  filename,
  variables: variables
    .refine((names) => names.some((name) => name !== "time"), {
      message:
        "Name at least one variable other than `time`; `time` is always read and reported on its own.",
    })
    .describe(
      "Variable identifiers to summarize (dotted paths), at least one other than `time`, which is always read and reported on its own.",
    ),
  points: z
    .number()
    .int()
    .min(2)
    .max(MAX_POINTS)
    .optional()
    .describe(
      "Also return each variable thinned to this many evenly spaced samples, first and last row included.",
    ),
});

/** Tool names this module registers, for the discovery tools' own index. */
export function registerResultTools(
  server: McpServer,
  deps: McpToolDeps,
): readonly string[] {
  const TOOL_NAME = "summarizeSimulationResult";
  registerTool(
    server,
    TOOL_NAME,
    {
      description:
        "Summarize variables of a simulation result file: the time span and row count, and each variable's initial, final, min and max values with the times of its extremes. Pass `points` to also get a decimated waveform. Far smaller than readSimulationResult, which returns every row.",
      inputSchema: SummarizeSimulationResultSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ filename, variables, points }) => {
      const names = [...new Set(variables)].filter((v) => v !== "time");
      const outcome = await invoke(deps, "readSimulationResult", {
        filename,
        variables: ["time", ...names],
      });
      if (!outcome.ok) return outcome.error;

      const matrix = resultMatrix(outcome.output, names.length + 1);
      if (matrix === undefined) {
        return errorResult(
          `readSimulationResult did not answer one row of numbers per variable for ${filename}, so there is nothing to summarize.`,
        );
      }
      const series = names.map((name, i) => ({
        name,
        values: matrix.rows[i] ?? [],
      }));
      return textResult(
        JSON.stringify(summarizeResult(matrix.time, series, points)),
      );
    },
  );
  return [TOOL_NAME];
}
