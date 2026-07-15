/**
 * Stories for `<om-documentation-interface>`, the read-only auto-generated
 * interface sections (extends tree, parameter table, connector table) shown
 * beneath a class's `Documentation(info=…)` HTML. Driven by plain
 * `DocumentationInterface` rows — no host, no OMC; the real webview derives them
 * from `getModelInstance`. Clicking a base class emits the bubbling, composed
 * `om-documentation-open-link` event (captured in the Actions panel); the live
 * host resolves it and opens that class's documentation.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/index.js";
import type { DocumentationInterface } from "../src/interface-model.js";

const PID: DocumentationInterface = {
  extendsTree: [
    {
      name: "Modelica.Blocks.Interfaces.SISO",
      comment: "Single Input Single Output continuous control block",
      children: [
        {
          name: "Modelica.Blocks.Icons.Block",
          comment: "Basic graphical layout of input/output block",
          children: [],
        },
      ],
    },
  ],
  parameters: [
    {
      name: "k",
      description: "Gain of controller",
      value: "1",
      group: "Parameters",
    },
    {
      name: "Ti",
      description: "Time constant of Integrator block",
      value: "0.5",
      unit: "s",
      group: "Parameters",
    },
    {
      name: "Td",
      description: "Time constant of Derivative block",
      value: "0.1",
      unit: "s",
      group: "Parameters",
    },
    {
      name: "initType",
      description: "Type of initialization",
      value: "Init.InitialState",
      group: "Initialization",
    },
    {
      name: "xi_start",
      description: "Initial or guess value for integrator output",
      value: "0",
      group: "Initialization",
    },
  ],
  connectors: [
    {
      name: "u",
      description: "Connector of setpoint input signal",
      typeName: "RealInput",
      direction: "input",
    },
    {
      name: "y",
      description: "Connector of actuator output signal",
      typeName: "RealOutput",
      direction: "output",
    },
  ],
};

const meta: Meta = {
  title: "documentation-ui/DocumentationInterface",
  parameters: {
    actions: { handles: ["om-documentation-open-link"] },
  },
};
export default meta;

type Story = StoryObj;

function host(model: DocumentationInterface | undefined): TemplateResult {
  return html`
    <div style="max-width: 48rem; padding: 1rem; border: 1px solid #8884;">
      <om-documentation-interface .model=${model}></om-documentation-interface>
    </div>
  `;
}

/** The full set: an inheritance tree, grouped parameters, and connectors. */
export const Full: Story = { render: () => host(PID) };

/** A class with only parameters — the single default group hides its heading. */
export const ParametersOnly: Story = {
  render: () =>
    host({
      extendsTree: [],
      connectors: [],
      parameters: [
        {
          name: "k",
          description: "Gain value multiplied with input signal",
          value: "1",
          group: "Parameters",
        },
      ],
    }),
};

/** Only the inheritance tree — clicking a base emits `om-documentation-open-link`. */
export const ExtendsOnly: Story = {
  render: () =>
    host({ extendsTree: PID.extendsTree, parameters: [], connectors: [] }),
};

/** Nothing to show (a class with no parameters, connectors, or bases): renders empty. */
export const Empty: Story = {
  render: () => host({ extendsTree: [], parameters: [], connectors: [] }),
};
