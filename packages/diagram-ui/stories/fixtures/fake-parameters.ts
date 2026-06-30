/**
 * Fake `ParameterModel`s for stories. In the extension these come from
 * OMC (`getParameterModel` for a component, simulation-options for the
 * model); here static models stand in so the parameter panel is editable
 * without a host.
 */

import type { ParameterModel } from "@dicode/omc-client";

const GENERAL = { tab: "General", group: "Parameters" } as const;

/** Simulation setup form — opened by the action panel's "simulate". */
export function simulationOptionsModel(className: string): ParameterModel {
  return {
    className,
    fields: [
      {
        name: "startTime",
        label: "Start time",
        kind: "number",
        value: 0,
        defaultValue: 0,
        dialog: GENERAL,
        unitOptions: [],
      },
      {
        name: "stopTime",
        label: "Stop time",
        kind: "number",
        value: 1,
        defaultValue: 1,
        dialog: GENERAL,
        unitOptions: [],
      },
      {
        name: "tolerance",
        label: "Tolerance",
        kind: "number",
        value: 1e-6,
        defaultValue: 1e-6,
        dialog: GENERAL,
        unitOptions: [],
      },
      {
        name: "method",
        label: "Integration method",
        kind: "enum",
        value: "dassl",
        defaultValue: "dassl",
        enumChoices: ["dassl", "ida", "euler", "rungekutta"],
        dialog: GENERAL,
        unitOptions: [],
      },
    ],
  };
}

/** Component parameter form — opened by double-clicking a component. */
export function componentParamsModel(componentName: string): ParameterModel {
  return {
    className: componentName,
    fields: [
      {
        name: "k",
        label: "Gain",
        kind: "number",
        value: 1,
        defaultValue: 1,
        dialog: GENERAL,
        unitOptions: [],
      },
      {
        name: "y_start",
        label: "Initial output",
        kind: "number",
        value: 0,
        defaultValue: 0,
        dialog: { tab: "Initialization", group: "Initial values" },
        unitOptions: [],
      },
      {
        name: "useSupport",
        label: "Use support flange",
        kind: "boolean",
        value: false,
        defaultValue: false,
        dialog: GENERAL,
        unitOptions: [],
      },
    ],
  };
}
