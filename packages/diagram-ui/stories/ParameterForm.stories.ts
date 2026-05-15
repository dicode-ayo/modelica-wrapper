/**
 * Stories for `<om-parameter-form>`. Schemas mirror what zod's
 * `toJSONSchema` produces for OMC's simulation-options / parameter
 * schemas, so the rendering is representative of the real wiring.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/parameter-form/parameter-form.component.js";

interface StoryArgs {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  title: string;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ParameterForm",
  render: ({ schema, values, title }: StoryArgs): TemplateResult => html`
    <div style="max-width: 540px;">
      <om-parameter-form
        .schema=${schema}
        .values=${values}
        title=${title}
        @om-parameter-change=${(e: Event) => {
          const ev = e as CustomEvent<{
            values: Record<string, unknown>;
          }>;
          console.log("[change]", ev.detail.values);
        }}
        @om-parameter-submit=${(e: Event) => {
          const ev = e as CustomEvent<{
            values: Record<string, unknown>;
          }>;
          console.log("[submit]", ev.detail.values);
        }}
        @om-parameter-cancel=${() => console.log("[cancel]")}
      ></om-parameter-form>
    </div>
  `,
};

export default meta;

type Story = StoryObj<StoryArgs>;

/**
 * Subset of OMC's `simulate` input schema — what the Simulate action
 * panel will pop up. Hits string / number / boolean / enum + a few
 * `optional().default(...)` fields so the renderer's full vocabulary
 * is exercised in one story.
 */
export const SimulationOptions: Story = {
  args: {
    title: "Simulate Modelica.Mechanics.Rotational.Examples.First",
    schema: {
      type: "object",
      properties: {
        startTime: {
          type: "number",
          default: 0,
          description: "Simulation start time in seconds.",
        },
        stopTime: {
          type: "number",
          default: 1,
          description: "Simulation stop time in seconds.",
        },
        numberOfIntervals: {
          type: "integer",
          default: 500,
          description: "Number of output points written to the result file.",
        },
        tolerance: {
          type: "number",
          default: 1e-6,
          description: "Solver relative tolerance.",
        },
        method: {
          type: "string",
          enum: ["dassl", "ida", "euler", "rungekutta", "cvode"],
          default: "dassl",
          description: "Integration method.",
        },
        outputFormat: {
          type: "string",
          enum: ["mat", "csv", "plt"],
          default: "mat",
          description: "On-disk result file format.",
        },
        variableFilter: {
          type: "string",
          default: ".*",
          description: "Regex selecting which result variables to store.",
        },
        emit_protected: {
          type: "boolean",
          default: false,
          description: "Include protected variables in the result file.",
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
        "emit_protected",
      ],
    },
    values: {},
  },
};

/**
 * Smaller component-parameter form — mimics what a click on an
 * `Inertia` component might surface.
 */
export const ComponentParameters: Story = {
  args: {
    title: "Inertia inertia1",
    schema: {
      type: "object",
      properties: {
        J: {
          type: "number",
          default: 1,
          description: "Moment of inertia (kg·m²).",
        },
        phi_start: {
          type: "number",
          default: 0,
          description: "Initial angle (rad).",
        },
        w_start: {
          type: "number",
          default: 0,
          description: "Initial angular velocity (rad/s).",
        },
        stateSelect: {
          type: "string",
          enum: ["default", "always", "prefer", "avoid", "never"],
          default: "default",
          description: "State selection priority for phi and w.",
        },
      },
      required: ["J"],
    },
    values: { J: 0.25, phi_start: 0, w_start: 0 },
  },
};

/**
 * Stress test: a `required` field with no default and no initial value
 * — submit should stay disabled until the user fills it in.
 */
export const RequiredFieldGating: Story = {
  args: {
    title: "Set value to enable submit",
    schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Required free-text. Submit is disabled until non-empty.",
        },
        count: {
          type: "integer",
          default: 1,
        },
      },
      required: ["name"],
    },
    values: {},
  },
};
