/**
 * A simulation result reduced to what checking it against an expectation
 * needs: each variable's endpoints and extremes, and optionally a waveform
 * thinned to a fixed number of samples. A whole series costs a model tokens
 * in proportion to the solver's output interval, which says nothing about how
 * much of it the model needs to read.
 *
 * Values carry {@link roundSignificant}'s digits; times are left as OMC gave
 * them, for the reason `roundResultOutput` leaves the `time` row alone.
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
  series?: Record<string, number[]>;
}

/** One requested variable's row, by the name the caller asked for it under. */
export interface NamedSeries {
  readonly name: string;
  readonly values: readonly number[];
}

/**
 * `points` row indices spread evenly over `rows`, the first and last always
 * among them, so a thinned waveform still starts and ends where the run did.
 * Every row when there are no more than `points` of them.
 */
export function decimatedIndices(rows: number, points: number): number[] {
  if (rows <= points) return Array.from({ length: rows }, (_, i) => i);
  if (points < 2) return [0, rows - 1].slice(0, Math.max(points, 0));
  const step = (rows - 1) / (points - 1);
  return Array.from({ length: points }, (_, k) => Math.round(k * step));
}

function summarizeSeries(
  time: readonly number[],
  values: readonly number[],
): VariableSummary {
  const initial = values.at(0);
  const final = values.at(-1);
  if (initial === undefined || final === undefined) {
    return {
      initial: null,
      final: null,
      min: null,
      max: null,
      minAt: null,
      maxAt: null,
    };
  }
  let minIndex = 0;
  let maxIndex = 0;
  let min = initial;
  let max = initial;
  values.forEach((v, i) => {
    if (v < min) {
      min = v;
      minIndex = i;
    }
    if (v > max) {
      max = v;
      maxIndex = i;
    }
  });
  return {
    initial: roundSignificant(initial),
    final: roundSignificant(final),
    min: roundSignificant(min),
    max: roundSignificant(max),
    minAt: time[minIndex] ?? null,
    maxAt: time[maxIndex] ?? null,
  };
}

function pick(values: readonly number[], indices: readonly number[]): number[] {
  return indices.flatMap((i) => {
    const v = values[i];
    return v === undefined ? [] : [v];
  });
}

/**
 * Every row of `series` is indexed by `time`. A variable named `time` belongs
 * in `time`, not `series`; it is the caller's to drop.
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
    ["time", pick(time, indices)],
    ...series.map(({ name, values }): [string, number[]] => [
      name,
      pick(values, indices).map(roundSignificant),
    ]),
  ]);
  return summary;
}

function isNumberRow(row: unknown): row is number[] {
  return Array.isArray(row) && row.every((v) => typeof v === "number");
}

/**
 * `readSimulationResult`'s `result` when it is the matrix it promises — `rows`
 * rows of numbers, all one length — and undefined for anything else.
 */
export function resultMatrix(
  output: unknown,
  rows: number,
): number[][] | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const result: unknown = Reflect.get(output, "result");
  if (!Array.isArray(result) || result.length !== rows) return undefined;
  if (!result.every(isNumberRow)) return undefined;
  const [first] = result;
  const length = first?.length ?? 0;
  return result.every((row) => row.length === length) ? result : undefined;
}
