/**
 * Helpers that build the parameter-panel inputs for `simulate(typeName, …)`.
 *
 * We don't just hand `describeFunctionAsJsonSchema("simulate").input`
 * to the panel because:
 *   - `typeName` is implicit (the active diagram already knows it),
 *   - several fields use the `"<default>"` literal as a sentinel that
 *     means "OMC, you decide" — exposing those raw to the user reads
 *     as a bug,
 *   - cflags / simflags / fileNamePrefix / options are advanced flags
 *     that don't belong in the first-cut UI.
 *
 * So we publish a hand-curated schema (the "essential" subset) and
 * seed the values from `getSimulationOptions(typeName)` for the four
 * fields it knows about. The remaining curated fields fall back to the
 * schema's own `default` values.
 *
 * Pure of vscode / dom imports — tested with a stub OmClient.
 */

import type { JsonSchema, OmcClient } from "@modelica-wrapper/omc-client";

/** Derived from `OmcClient.getSimulationOptions`'s return — avoids
 *  re-declaring the same five fields and stays in sync if OMC adds more. */
type GetSimulationOptionsOutput = Awaited<
  ReturnType<OmcClient["getSimulationOptions"]>
>;

/**
 * Curated JSON Schema for the simulate parameter panel. Field order
 * matches what users typically scan top-to-bottom in OMEdit's
 * Simulation Setup dialog.
 *
 * Build-time constant so it's easy to test that we didn't drop a key
 * by accident.
 */
export const SIMULATE_FORM_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    startTime: {
      type: "number",
      default: 0,
      description: "Simulation start time (s).",
    },
    stopTime: {
      type: "number",
      default: 1,
      description: "Simulation stop time (s).",
    },
    numberOfIntervals: {
      type: "integer",
      default: 500,
      description: "Number of output intervals written to the result file.",
    },
    tolerance: {
      type: "number",
      default: 1e-6,
      description: "Solver relative tolerance.",
    },
    method: {
      type: "string",
      enum: [
        "dassl",
        "ida",
        "cvode",
        "rungekutta",
        "euler",
        "trapezoid",
        "<default>",
      ],
      default: "dassl",
      description: "Integration method; `<default>` lets OMC choose.",
    },
    outputFormat: {
      type: "string",
      enum: ["mat", "csv", "plt", "empty"],
      default: "mat",
      description: "On-disk result file format.",
    },
    variableFilter: {
      type: "string",
      default: ".*",
      description: "Regex selecting which variables are stored.",
    },
  },
  required: [
    "startTime",
    "stopTime",
    "numberOfIntervals",
    "tolerance",
    "method",
    "outputFormat",
    "variableFilter",
  ],
};

/**
 * Compose the panel's initial value record. Calls
 * `getSimulationOptions(typeName)` to pick up the user's
 * `experiment` annotation (or OMC's fallbacks if absent); curated
 * fields not covered by that API stay at their schema default.
 *
 * Returns a `{schema, values}` pair ready to pass straight into
 * `DiagramPanel.openParameters`.
 */
export async function buildSimulateForm(
  client: OmcClient,
  typeName: string,
): Promise<{ schema: JsonSchema; values: Record<string, unknown> }> {
  let opts: GetSimulationOptionsOutput | undefined;
  try {
    opts = await client.getSimulationOptions({ typeName });
  } catch {
    // Some classes (e.g. a freshly-created model with no experiment
    // annotation) make getSimulationOptions throw; the schema's own
    // defaults are a sensible fallback.
    opts = undefined;
  }
  const schemaDefaults = defaultsFromSchema(SIMULATE_FORM_SCHEMA);
  const values: Record<string, unknown> = {
    ...schemaDefaults,
    ...(opts
      ? {
          startTime: opts.startTime,
          stopTime: opts.stopTime,
          tolerance: opts.tolerance,
          numberOfIntervals: opts.numberOfIntervals,
        }
      : {}),
  };
  return { schema: SIMULATE_FORM_SCHEMA, values };
}

/**
 * Translate the panel's submitted values into a `simulate(...)` input.
 * Currently a pass-through over a fixed key set — kept as its own
 * function so a future schema tweak (renaming fields, splitting the
 * method enum into "method" + "<default>" toggle, …) only has to touch
 * one place.
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

function defaultsFromSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type !== "object" || !schema.properties) return out;
  for (const [name, raw] of Object.entries(schema.properties)) {
    if (raw && typeof raw === "object" && "default" in raw) {
      out[name] = (raw as { default: unknown }).default;
    }
  }
  return out;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
