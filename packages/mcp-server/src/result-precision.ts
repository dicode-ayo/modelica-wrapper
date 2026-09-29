/**
 * Significant digits kept on a simulation result's numbers. Six reads a
 * waveform against theory and stays inside the 1e-6 solver tolerance
 * `simulate` defaults to; everything past it is IEEE-754 repr noise the model
 * pays tokens for.
 */
export const RESULT_SIGNIFICANT_DIGITS = 6;

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
 * `output` with every number in a `readSimulationResult` matrix rounded. Any
 * other shape is returned untouched, so a surprise in OMC's answer reaches the
 * model as it is rather than as a rounding artifact.
 */
export function roundResultOutput(output: unknown): unknown {
  if (!isRecord(output) || !Array.isArray(output["result"])) return output;
  return {
    ...output,
    result: output["result"].map((row: unknown) =>
      Array.isArray(row)
        ? row.map((v: unknown) =>
            typeof v === "number" ? roundSignificant(v) : v,
          )
        : row,
    ),
  };
}
