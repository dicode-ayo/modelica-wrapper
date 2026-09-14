/**
 * Submit-side helpers for the simulate parameter panel.
 *
 * The panel itself is a `ParameterModel` from omc-client's
 * `produceSimulationModel` (see `docs/parameter-model-design.md`). What lives
 * here is the submit mapping: the panel's flat `values` map to a
 * `simulate(...)` input.
 *
 * Pure of vscode / dom imports — tested with a stub value map.
 */

import { classNameToFilePrefix } from "@dicode/omc-client";

/**
 * The simulate input shape the host passes to `OmcClient.simulate`. A subset of
 * the wrapper's full input — the advanced flags (cflags / simflags / options)
 * aren't surfaced in the panel.
 */
export type SimulateFormSubmit = {
  typeName: string;
  startTime?: number;
  stopTime?: number;
  numberOfIntervals?: number;
  tolerance?: number;
  method?: string;
  outputFormat?: string;
  variableFilter?: string;
  fileNamePrefix?: string;
};

/**
 * Translate the panel's submitted values into a `simulate(...)` input.
 *
 * We *omit* fields with `undefined` rather than assigning them so that
 * `exactOptionalPropertyTypes` is happy and OMC sees the wrapper's own
 * defaults take over for empty inputs. `Object.fromEntries(Object.entries(…).filter)`
 * is the most legible form of "drop nullable keys" in TypeScript.
 *
 * `fileNamePrefix` is always derived from the class name — never left at the
 * wrapper's `"<default>"` sentinel, which OMC takes as a literal prefix and
 * turns into filenames carrying `<` and `>`.
 *
 * `method` carries the panel's `SOLVER_METHODS` selection through unchanged,
 * including the `"<default>"` sentinel — which `OmcClient.simulate` omits from
 * the call so OMC picks its own default solver.
 */
export function simulateInputFromFormValues(
  typeName: string,
  values: Record<string, unknown>,
): SimulateFormSubmit {
  const candidate: Record<string, unknown> = {
    startTime: numberOrUndefined(values.startTime),
    stopTime: numberOrUndefined(values.stopTime),
    numberOfIntervals: numberOrUndefined(values.numberOfIntervals),
    tolerance: numberOrUndefined(values.tolerance),
    method: stringOrUndefined(values.method),
    outputFormat: stringOrUndefined(values.outputFormat),
    variableFilter: stringOrUndefined(values.variableFilter),
  };
  const defined = Object.fromEntries(
    Object.entries(candidate).filter(([, v]) => v !== undefined),
  );
  return {
    typeName,
    ...defined,
    fileNamePrefix: classNameToFilePrefix(typeName),
  } as SimulateFormSubmit;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
