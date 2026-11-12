/**
 * OMC: `function readSimulationResult`
 *
 * ```modelica
 * function readSimulationResult
 *   input String filename;
 *   input VariableNames variables;
 *   input Integer size = 0;
 *   output Real result[:, :];
 * end readSimulationResult;
 * ```
 *
 * `variables` is a list of dotted-path variable identifiers emitted as a
 * brace-list (e.g. `{a.b, a[1].b[3].c}`). OMC's own `size = 0` ("any size")
 * silently returns an empty matrix on some result formats instead of the
 * documented behavior, so a `size` of 0 (or omitted) here is resolved via
 * `readSimulationResultSize` first and that row count is passed through
 * instead. Passing a non-zero `size` still requires an exact match to the
 * file's row count, which is solver-dependent and not safely computed
 * caller-side.
 *
 * The two calls a resolved size takes are not atomic against a rewrite of
 * the same file from outside this client. So when a resolved size answers
 * `fail()`, the row count is read once more: if it moved, the read is
 * retried once at the new count; if not, the original failure stands. A
 * caller-supplied non-zero `size` is never retried.
 *
 * A `size` that does not match, a variable the file does not hold, and a
 * file OMC cannot open all answer `fail()` and nothing else; only the error
 * buffer says which of the three it was.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { resultVariable } from "../../_shared/fields.js";
import { quote } from "../../_shared/format.js";
import { parseOutput, readFailure } from "../../_shared/parseOutput.js";
import { OmcDiagnosticError } from "../../error-buffer.js";
import { asFloat, expectList, parse } from "../../parse.js";
import { readSimulationResultSize } from "./readSimulationResultSize.js";

export const ReadSimulationResultInputSchema = z.strictObject({
  filename: z
    .string()
    .describe("Path to the simulation result file (.mat / .csv / etc.)."),
  variables: z
    .array(resultVariable)
    .describe(
      "Variable identifiers to read (dotted paths), each emitted to OMC unquoted.",
    ),
  size: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe(
      "Number of rows expected; 0 (default) resolves the file's actual " +
        "row count for you, non-zero must match the file exactly.",
    ),
});
export type ReadSimulationResultInput = z.input<
  typeof ReadSimulationResultInputSchema
>;

export const ReadSimulationResultOutputSchema = z.object({
  result: z
    .array(z.array(z.number()))
    .describe(
      "Variable values as a 2D `Real[:, :]` matrix (one row per variable in the same order as `variables`).",
    ),
});
export type ReadSimulationResultOutput = z.infer<
  typeof ReadSimulationResultOutputSchema
>;

export const ReadSimulationResultDescription =
  "Read the values of named variables from a simulation result file as a 2D `Real[:, :]` matrix.";

async function readSize(ctx: CallContext, filename: string): Promise<number> {
  const { size } = await readSimulationResultSize(ctx, { fileName: filename });
  return size;
}

/** Undefined when OMC answers fail(); the reason stays in the buffer. */
async function readRows(
  ctx: CallContext,
  input: ReadSimulationResultInput,
  size: number,
): Promise<number[][] | undefined> {
  // Passing 0 through would reach OMC's own `size = 0` path, which answers
  // an empty matrix on some formats. There are no rows to read, but the
  // output still owes one (empty) row per variable.
  if (size === 0) return input.variables.map(() => []);
  const variableList = `{${input.variables.join(", ")}}`;
  const raw = await ctx.call(
    `readSimulationResult(${quote(input.filename)}, ${variableList}, ${size})`,
  );
  const value = parse(raw);
  if (value.kind === "call" && value.name === "fail") return undefined;
  return expectList(value).map((row) =>
    expectList(row).map((v) => asFloat(v) ?? 0),
  );
}

async function readRowsOrThrow(
  ctx: CallContext,
  input: ReadSimulationResultInput,
  size: number,
): Promise<number[][]> {
  const rows = await readRows(ctx, input, size);
  if (rows === undefined) {
    throw await readFailure(ctx, "readSimulationResult");
  }
  return rows;
}

async function readResolved(
  ctx: CallContext,
  input: ReadSimulationResultInput,
): Promise<number[][]> {
  const resolved = await readSize(ctx, input.filename);
  const rows = await readRows(ctx, input, resolved);
  if (rows !== undefined) return rows;
  // Drained before the second size read, so the retry's reason, if any, is
  // its own; and a file OMC can no longer size keeps this read's reason.
  const failure = await readFailure(ctx, "readSimulationResult");
  const current = await readSize(ctx, input.filename).catch(
    (error: unknown) => {
      if (error instanceof OmcDiagnosticError) return undefined;
      throw error;
    },
  );
  if (current === undefined || current === resolved) throw failure;
  return readRowsOrThrow(ctx, input, current);
}

export async function readSimulationResult(
  ctx: CallContext,
  input: ReadSimulationResultInput,
): Promise<ReadSimulationResultOutput> {
  const result =
    input.size !== undefined && input.size !== 0
      ? await readRowsOrThrow(ctx, input, input.size)
      : await readResolved(ctx, input);
  return parseOutput(
    ReadSimulationResultOutputSchema,
    { result },
    "readSimulationResult",
  );
}
