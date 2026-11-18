/**
 * A simulation result reduced to what checking it against an expectation
 * needs: each variable's endpoints and extremes, and optionally a waveform
 * thinned to a fixed number of samples.
 *
 * Takes OMC's unrounded values and rounds each reported one once, to
 * {@link roundSignificant}'s digits, so a rounding tie never decides where an
 * extreme falls. Times are left as OMC gave them, for the reason
 * `roundResultOutput` leaves the `time` row alone.
 */

import { ReadSimulationResultOutputSchema } from "@dicode/omc-client";

import { roundSignificant } from "./result-precision.js";

/**
 * `null` throughout when the result has no rows. A non-finite `initial` or
 * `final` is `null`, and `min`/`max` range over the finite values only.
 */
export interface VariableSummary {
  initial: number | null;
  final: number | null;
  min: number | null;
  max: number | null;
  /** The time of the first row holding the minimum. */
  minAt: number | null;
  /** The time of the first row holding the maximum. */
  maxAt: number | null;
  /** Rows holding NaN or an infinity; present only when there are any. */
  nonFinite?: number;
}

export interface ResultSummary {
  time: { start: number | null; stop: number | null; rows: number };
  variables: Record<string, VariableSummary>;
  /** A non-finite value is `null`, as JSON would carry it anyway. */
  series?: Record<string, (number | null)[]>;
}

/** One requested variable's row, by the name the caller asked for it under. */
export interface NamedSeries {
  readonly name: string;
  readonly values: readonly number[];
}

/**
 * `points` row indices spread evenly over `rows`, the first and last always
 * among them, so a thinned waveform still starts and ends where the run did.
 * Every row when there are no more than `points` of them. `points` is at
 * least 2.
 */
export function decimatedIndices(rows: number, points: number): number[] {
  if (rows <= points) return Array.from({ length: rows }, (_, i) => i);
  const step = (rows - 1) / (points - 1);
  return Array.from({ length: points }, (_, k) => Math.round(k * step));
}

function rounded(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value)
    ? roundSignificant(value)
    : null;
}

function summarizeSeries(
  time: readonly number[],
  values: readonly number[],
): VariableSummary {
  let min: { value: number; at: number | null } | undefined;
  let max: { value: number; at: number | null } | undefined;
  let nonFinite = 0;
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) {
      nonFinite += 1;
      return;
    }
    const at = time[i] ?? null;
    if (min === undefined || value < min.value) min = { value, at };
    if (max === undefined || value > max.value) max = { value, at };
  });
  const summary: VariableSummary = {
    initial: rounded(values.at(0)),
    final: rounded(values.at(-1)),
    min: rounded(min?.value),
    max: rounded(max?.value),
    minAt: min?.at ?? null,
    maxAt: max?.at ?? null,
  };
  if (nonFinite > 0) summary.nonFinite = nonFinite;
  return summary;
}

/**
 * Every row of `series` is indexed by `time`, and as long. A variable named
 * `time` belongs in `time`, not `series`; it is the caller's to drop.
 */
export function summarizeResult(
  time: readonly number[],
  series: readonly NamedSeries[],
  points?: number,
): ResultSummary {
  const summary: ResultSummary = {
    time: {
      start: time.at(0) ?? null,
      stop: time.at(-1) ?? null,
      rows: time.length,
    },
    variables: Object.fromEntries(
      series.map(({ name, values }) => [name, summarizeSeries(time, values)]),
    ),
  };
  if (points === undefined) return summary;
  const indices = decimatedIndices(time.length, points);
  summary.series = Object.fromEntries([
    ["time", indices.map((i) => time[i] ?? null)],
    ...series.map(({ name, values }): [string, (number | null)[]] => [
      name,
      indices.map((i) => rounded(values[i])),
    ]),
  ]);
  return summary;
}

/**
 * `readSimulationResult`'s `result` split into its `time` row and the rest,
 * when it is the matrix it promises — `count` rows of numbers, all one length —
 * and undefined for anything else.
 */
export function resultMatrix(
  output: unknown,
  count: number,
): { time: number[]; rows: number[][] } | undefined {
  const parsed = ReadSimulationResultOutputSchema.safeParse(output);
  if (!parsed.success) return undefined;
  const [time, ...rest] = parsed.data.result;
  if (time === undefined || rest.length !== count - 1) return undefined;
  return rest.every((row) => row.length === time.length)
    ? { time, rows: rest }
    : undefined;
}
