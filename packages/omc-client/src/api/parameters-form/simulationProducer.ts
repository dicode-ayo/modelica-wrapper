/**
 * Pure producer: simulate-setup inputs → `ParameterModel`. Sibling to
 * `produceParameterModel`, emitting the SAME render contract so the webview
 * renders the simulate panel through one code path with the parameter panels.
 *
 * The simulate option set is only PARTLY standardized by Modelica:
 *  - The `experiment` annotation (Modelica spec §18.4) standardizes
 *    `StartTime / StopTime / Interval / Tolerance` — and nothing else. Those
 *    values arrive via `getSimulationOptions()` as `GetSimulationOptionsOutput`.
 *  - The remaining options (`numberOfIntervals`, `method`, `outputFormat`,
 *    `variableFilter`, …) are OMC-specific, defined by OMC's `simulate`
 *    scripting signature. Their structure + defaults come from that signature
 *    (encoded by the typed `simulate` wrapper); the `method` choices come from
 *    the maintained {@link SOLVER_METHODS} constant (there is no scripting API
 *    for that list — see `solverMethods.ts`).
 *
 * No OMC contact: the host fetches `getSimulationOptions()` and hands the
 * result in. The submit mapping is unchanged and stays in the extension
 * (`simulateInputFromFormValues`); only form *construction* lives here.
 */

import type { GetSimulationOptionsOutput } from "../execution/getSimulationOptions.js";
import {
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_SOLVER_METHOD,
  OUTPUT_FORMATS,
  SOLVER_METHODS,
} from "./solverMethods.js";
import type { ParameterField, ParameterModel } from "./types.js";

/** Dialog groups the simulate fields are bucketed into, in display order. */
export const SIMULATION_GROUP = {
  general: "General",
  solver: "Solver",
  output: "Output",
} as const;

/** Default tab for the simulate panel (matches the parameter panels' default). */
export const SIMULATION_TAB = "General";

/**
 * Schema-default seeds for the OMC-specific fields the `experiment` annotation
 * (and therefore `getSimulationOptions`) does not cover. These mirror OMC's
 * `simulate` signature defaults so the panel shows the same starting values the
 * wrapper would apply.
 */
const SIMULATE_DEFAULTS = {
  method: DEFAULT_SOLVER_METHOD as string,
  outputFormat: DEFAULT_OUTPUT_FORMAT as string,
  variableFilter: ".*",
} as const;

export interface ProduceSimulationModelOptions {
  /** Class being set up for simulation (echoed onto `ParameterModel.className`). */
  className: string;
  /**
   * The `experiment`-annotation values (`startTime`, `stopTime`, `tolerance`,
   * `numberOfIntervals`, `interval`) resolved by `getSimulationOptions()`.
   */
  options: GetSimulationOptionsOutput;
}

/**
 * Build the simulate panel's `ParameterModel`.
 *
 * `className` is set; `component` is unset (this is a class-level setup, not a
 * sub-component's parameters). Fields are seeded from `options` (the
 * `experiment` values) with schema defaults filling the OMC-specific fields.
 * The field NAMES match `simulateInputFromFormValues`'s expected keys so submit
 * stays unchanged.
 */
export function produceSimulationModel(
  opts: ProduceSimulationModelOptions,
): ParameterModel {
  const { className, options } = opts;
  const fields: ParameterField[] = [
    numberField({
      name: "startTime",
      label: "Start time",
      value: options.startTime,
      defaultValue: 0,
      unit: "s",
      group: SIMULATION_GROUP.general,
    }),
    numberField({
      name: "stopTime",
      label: "Stop time",
      value: options.stopTime,
      defaultValue: 1,
      unit: "s",
      group: SIMULATION_GROUP.general,
    }),
    numberField({
      name: "interval",
      label: "Interval",
      value: options.interval,
      defaultValue: 0,
      unit: "s",
      group: SIMULATION_GROUP.general,
    }),
    integerField({
      name: "numberOfIntervals",
      label: "Number of intervals",
      value: options.numberOfIntervals,
      defaultValue: 500,
      group: SIMULATION_GROUP.solver,
    }),
    numberField({
      name: "tolerance",
      label: "Tolerance",
      value: options.tolerance,
      defaultValue: 1e-6,
      group: SIMULATION_GROUP.solver,
    }),
    enumField({
      name: "method",
      label: "Method",
      value: SIMULATE_DEFAULTS.method,
      defaultValue: SIMULATE_DEFAULTS.method,
      choices: [...SOLVER_METHODS],
      group: SIMULATION_GROUP.solver,
    }),
    enumField({
      name: "outputFormat",
      label: "Output format",
      value: SIMULATE_DEFAULTS.outputFormat,
      defaultValue: SIMULATE_DEFAULTS.outputFormat,
      choices: [...OUTPUT_FORMATS],
      group: SIMULATION_GROUP.output,
    }),
    stringField({
      name: "variableFilter",
      label: "Variable filter",
      value: SIMULATE_DEFAULTS.variableFilter,
      defaultValue: SIMULATE_DEFAULTS.variableFilter,
      group: SIMULATION_GROUP.output,
    }),
  ];

  return { className, fields };
}

// ---------- field builders ----------

interface ScalarFieldSpec {
  name: string;
  label: string;
  group: string;
}

function numberField(
  spec: ScalarFieldSpec & {
    value: number;
    defaultValue: number;
    unit?: string;
  },
): ParameterField {
  const field: ParameterField = {
    name: spec.name,
    label: spec.label,
    kind: "number",
    value: spec.value,
    defaultValue: spec.defaultValue,
    dialog: { tab: SIMULATION_TAB, group: spec.group },
    unitOptions: [],
  };
  if (spec.unit !== undefined) field.unit = spec.unit;
  return field;
}

function integerField(
  spec: ScalarFieldSpec & { value: number; defaultValue: number },
): ParameterField {
  return {
    name: spec.name,
    label: spec.label,
    kind: "integer",
    value: spec.value,
    defaultValue: spec.defaultValue,
    dialog: { tab: SIMULATION_TAB, group: spec.group },
    unitOptions: [],
  };
}

function stringField(
  spec: ScalarFieldSpec & { value: string; defaultValue: string },
): ParameterField {
  return {
    name: spec.name,
    label: spec.label,
    kind: "string",
    value: spec.value,
    defaultValue: spec.defaultValue,
    dialog: { tab: SIMULATION_TAB, group: spec.group },
    unitOptions: [],
  };
}

function enumField(
  spec: ScalarFieldSpec & {
    value: string;
    defaultValue: string;
    choices: string[];
  },
): ParameterField {
  return {
    name: spec.name,
    label: spec.label,
    kind: "enum",
    value: spec.value,
    defaultValue: spec.defaultValue,
    enumChoices: spec.choices,
    dialog: { tab: SIMULATION_TAB, group: spec.group },
    unitOptions: [],
  };
}
