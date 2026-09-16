/**
 * The time window a simulation actually ran over, for the run summary.
 *
 * Pure of vscode imports — tested against OMC's echoed options string.
 */

/**
 * The simulated time window, as OMC reports having run it.
 *
 * An omitted `startTime` / `stopTime` is resolved by OMC from the class's
 * `experiment` annotation, so the submitted input cannot say what ran. OMC
 * echoes the resolved options back on the result; the input covers an echo that
 * cannot be read, and a bound neither source knows leaves the window out of the
 * summary.
 */
export function runWindow(
  simulationOptions: string,
  input: { startTime?: number; stopTime?: number },
): { start: number; stop: number } | undefined {
  const start =
    readSimulationOption(simulationOptions, "startTime") ?? input.startTime;
  const stop =
    readSimulationOption(simulationOptions, "stopTime") ?? input.stopTime;
  if (start === undefined || stop === undefined) return undefined;
  return { start, stop };
}

/**
 * One bound out of OMC's `key = value, key = value` echo. A bound that is
 * absent, blank, or unparseable reads as unknown so the caller can fall back
 * instead of formatting it.
 */
function readSimulationOption(
  options: string,
  name: "startTime" | "stopTime",
): number | undefined {
  const raw = new RegExp(`\\b${name} = ([^,]+)`).exec(options)?.[1]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
