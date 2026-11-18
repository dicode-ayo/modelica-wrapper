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

import { roundSignificant } from "./result-precision.js";

/** `null` throughout when the result has no rows. */
export interface VariableSummary {
  initial: number | null;
  final: number | null;
  min: number | null;
  max: number | null;
  /** The time of the first row holding the minimum. */
  minAt: number | null;
  /** The time of the first row holding the maximum. */
  maxAt: number | null;
}

export interface ResultSummary {
  time: { start: number | null; stop: number | null; rows: number };
  variables: Record<string, VariableSummary>;
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
  return value === undefined ? null : roundSignificant(value);
}

function summarizeSeries(
  time: readonly number[],
  values: readonly number[],
): VariableSummary {
  let min: { value: number; at: number | null } | undefined;
  let max: { value: number; at: number | null } | undefined;
  values.forEach((value, i) => {
    const at = time[i] ?? null;
    if (min === undefined || value < min.value) min = { value, at };
    if (max === undefined || value > max.value) max = { value, at };
  });
  return {
    initial: rounded(values.at(0)),
    final: rounded(values.at(-1)),
    min: rounded(min?.value),
    max: rounded(max?.value),
    minAt: min?.at ?? null,
    maxAt: max?.at ?? null,
  };
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
 * `readSimulationResult`'s `result` split into its `time` row and one series
 * per name in `names`, when it holds exactly that many rows, all one length,
 * and undefined otherwise.
 */
export function resultSeries(
  output: { readonly result: readonly (readonly number[])[] },
  names: readonly string[],
): { time: readonly number[]; series: NamedSeries[] } | undefined {
  const [time, ...rows] = output.result;
  if (time === undefined || rows.length !== names.length) return undefined;
  const series: NamedSeries[] = [];
  for (const [i, name] of names.entries()) {
    const values = rows[i];
    if (values === undefined || values.length !== time.length) return undefined;
    series.push({ name, values });
  }
  return { time, series };
}
