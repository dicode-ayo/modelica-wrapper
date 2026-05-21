/**
 * Submit-side helpers for the simulate parameter panel.
 *
 * The simulate panel is now built from omc-client's pure
 * `produceSimulationModel` (seeded by `getSimulationOptions` + the documented
 * `SOLVER_METHODS` constant) and rendered directly as a `ParameterModel` — the
 * old curated `SIMULATE_FORM_SCHEMA` + `buildSimulateForm` were removed (see
 * `docs/parameter-model-design.md`, Revision 2026-05-21). What stays here is the
 * SUBMIT mapping: translating the panel's flat `values` map into a
 * `simulate(...)` input. Keeping it in one place means a future field tweak
 * only touches the submit translator.
 *
 * Pure of vscode / dom imports — tested with a stub value map.
 */

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
 * `fileNamePrefix` is always derived from the class name (dots →
 * underscores) — never left at the wrapper's `"<default>"` sentinel.
 * OMC takes that sentinel as a *literal* string prefix on at least
 * some versions, which produces filenames containing `<` and `>`,
 * which then crash the shell at compile time
 * (`/bin/sh: 1: cannot open default`). Sanitising once here keeps the
 * whole build chain shell-safe.
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

/**
 * Derive a filesystem-safe `fileNamePrefix` from a Modelica class name.
 * Dots are turned into underscores so the generated C files / Makefile
 * / executable have plain identifier-shaped names that survive every
 * shell and most filesystems. We keep the full dotted path (rather
 * than just the leaf name) so two classes with the same leaf name in
 * different packages don't share an output directory.
 */
export function classNameToFilePrefix(typeName: string): string {
  return typeName.replace(/\./g, "_");
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
