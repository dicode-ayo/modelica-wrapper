/**
 * Reading a simulation result for what a model checks it against, rather than
 * for the whole waveform. The read itself goes through `readSimulationResult`,
 * so its gate, logging and failure handling apply. An answer whose rows do not
 * match `variables` is this tool's to report.
 */

import { ReadSimulationResultInputSchema } from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  dispatch,
  errorResult,
  textResult,
  type McpToolDeps,
} from "./dispatch.js";
import { registerTool } from "./register-tool.js";
import { resultSeries, summarizeResult } from "./result-summary.js";

const MAX_POINTS = 1000;

const { filename, variables } = ReadSimulationResultInputSchema.shape;

const SummarizeSimulationResultSchema = z.strictObject({
  filename,
  variables: variables
    // Publishes `minItems: 1`; the refinement has no JSON Schema form.
    .min(1)
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
      return dispatch(
        deps,
        "readSimulationResult",
        { filename, variables: ["time", ...names] },
        {
          label: TOOL_NAME,
          respond: (output) => {
            const matrix = resultSeries(output, names);
            if (matrix === undefined) {
              return errorResult(
                `readSimulationResult did not answer one equal-length row of numbers per variable for ${filename}, so there is nothing to summarize.`,
              );
            }
            return textResult(
              JSON.stringify(
                summarizeResult(matrix.time, matrix.series, points),
              ),
            );
          },
        },
      );
    },
  );
  return [TOOL_NAME];
}
