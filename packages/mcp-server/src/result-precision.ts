/**
 * Significant digits kept on a simulation result's numbers. Six reads a
 * waveform against theory, and the digits past it sit below the 1e-6 solver
 * tolerance `simulate` defaults to, so they cost the model tokens for values
 * the solver does not vouch for.
 */
const RESULT_SIGNIFICANT_DIGITS = 6;

/**
 * Significant digits rather than decimal places: a decimal-place round would
 * flatten a small-magnitude signal (a 1e-9 A current) to zero.
 */
export function roundSignificant(value: number): number {
  return Number(value.toPrecision(RESULT_SIGNIFICANT_DIGITS));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `output` with every number rounded except the `time` row: at 6 digits the
 * timestamps of a long run collapse into duplicates, and the axis is what
 * every other row is indexed by. `variables` names the rows in order. Any
 * other shape is returned untouched.
 */
export function roundResultOutput(
  output: unknown,
  variables: readonly unknown[],
): unknown {
  if (!isRecord(output) || !Array.isArray(output["result"])) return output;
  return {
    ...output,
    result: output["result"].map((row: unknown, i: number) =>
      Array.isArray(row) && variables[i] !== "time"
        ? row.map((v: unknown) =>
            typeof v === "number" ? roundSignificant(v) : v,
          )
        : row,
    ),
  };
}
