/**
 * Stories for `<om-parameter-form>`. The fixtures are `ParameterModel`s — the
 * same typed shape the producers emit and the webview renders directly, so the
 * stories are representative of the real wiring.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import type { ParameterModel } from "@dicode/omc-client";
import { html, type TemplateResult } from "lit";

import "../src/parameter-form/parameter-form.component.js";

interface StoryArgs {
  model: ParameterModel;
  title: string;
}

const G = { tab: "General", group: "Parameters" } as const;

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ParameterForm",
  render: ({ model, title }: StoryArgs): TemplateResult => html`
    <div style="max-width: 540px;">
      <om-parameter-form
        .model=${model}
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
 * The simulate-setup model `produceSimulationModel` emits — string / number /
 * integer / enum fields grouped by Dialog group, so the renderer's full
 * vocabulary is exercised in one story.
 */
export const SimulationOptions: Story = {
  args: {
    title: "Simulate Modelica.Mechanics.Rotational.Examples.First",
    model: {
      className: "Modelica.Mechanics.Rotational.Examples.First",
      fields: [
        { name: "startTime", label: "Start time", kind: "number", value: 0, defaultValue: 0, unit: "s", dialog: { tab: "General", group: "General" }, unitOptions: [] },
        { name: "stopTime", label: "Stop time", kind: "number", value: 1, defaultValue: 1, unit: "s", dialog: { tab: "General", group: "General" }, unitOptions: [] },
        { name: "numberOfIntervals", label: "Number of intervals", kind: "integer", value: 500, defaultValue: 500, dialog: { tab: "General", group: "Solver" }, unitOptions: [] },
        { name: "tolerance", label: "Tolerance", kind: "number", value: 1e-6, defaultValue: 1e-6, dialog: { tab: "General", group: "Solver" }, unitOptions: [] },
        { name: "method", label: "Method", kind: "enum", value: "dassl", defaultValue: "dassl", enumChoices: ["dassl", "ida", "cvode", "gbode", "euler", "rungekutta"], dialog: { tab: "General", group: "Solver" }, unitOptions: [] },
        { name: "outputFormat", label: "Output format", kind: "enum", value: "mat", defaultValue: "mat", enumChoices: ["mat", "csv", "plt", "empty"], dialog: { tab: "General", group: "Output" }, unitOptions: [] },
        { name: "variableFilter", label: "Variable filter", kind: "string", value: ".*", defaultValue: ".*", dialog: { tab: "General", group: "Output" }, unitOptions: [] },
      ],
    },
  },
};

/**
 * Smaller component-parameter form — mimics what a click on an
 * `Inertia` component might surface.
 */
export const ComponentParameters: Story = {
  args: {
    title: "Inertia inertia1",
    model: {
      className: "Modelica.Mechanics.Rotational.Components.Inertia",
      component: "inertia1",
      fields: [
        { name: "J", label: "Moment of inertia (kg·m²).", kind: "number", value: 0.25, defaultValue: 1, dialog: G, unitOptions: [] },
        { name: "phi_start", label: "Initial angle (rad).", kind: "number", value: 0, defaultValue: 0, dialog: G, unitOptions: [] },
        { name: "w_start", label: "Initial angular velocity (rad/s).", kind: "number", value: 0, defaultValue: 0, dialog: G, unitOptions: [] },
        { name: "stateSelect", label: "State selection priority for phi and w.", kind: "enum", value: "default", defaultValue: "default", enumChoices: ["default", "always", "prefer", "avoid", "never"], dialog: G, unitOptions: [] },
      ],
    },
  },
};

/** Exact rad→deg scale factor (`convertUnits("rad", "deg")`). */
const RAD_PER_DEG = 0.017453292519943295;

/**
 * Exercises the unit widgets next to the value control, the way a
 * host-enriched model surfaces them (see `unit-display.ts`):
 *
 *   - `startTime` — `unit` with no option list → a static **suffix** (`s`).
 *   - `J` — bare multi-char unit (`kg.m2`) → suffix.
 *   - `phi` — base `rad` + `displayUnit` `deg` + two options → a **dropdown**
 *     defaulting to `deg`, converting the `rad` initial on open.
 *   - `T` — base `K` + `displayUnit` `degC` → dropdown exercising the affine
 *     `offset` (273.15) leg of the conversion.
 *   - `length` — base `m` with four short options → dropdown with several
 *     choices.
 */
export const ParametersWithUnits: Story = {
  args: {
    title: "Parameters with units",
    model: {
      className: "Demo.WithUnits",
      fields: [
        { name: "startTime", label: "Time instant at which movement starts.", kind: "number", value: 0.5, defaultValue: 0.5, unit: "s", dialog: G, unitOptions: [] },
        { name: "J", label: "Moment of inertia.", kind: "number", value: 0.25, defaultValue: 1, unit: "kg.m2", dialog: G, unitOptions: [{ unit: "kg.m2", scaleFactor: 1, offset: 0 }] },
        {
          name: "phi",
          label: "Initial angle — base unit rad, shown in deg.",
          kind: "number",
          value: 1.5707963267948966,
          defaultValue: 0,
          unit: "rad",
          displayUnit: "deg",
          dialog: G,
          unitOptions: [
            { unit: "rad", scaleFactor: 1, offset: 0 },
            { unit: "deg", scaleFactor: RAD_PER_DEG, offset: 0 },
          ],
        },
        {
          name: "T",
          label: "Temperature — base unit K, shown in °C (affine offset).",
          kind: "number",
          value: 293.15,
          defaultValue: 293.15,
          unit: "K",
          displayUnit: "degC",
          dialog: G,
          unitOptions: [
            { unit: "K", scaleFactor: 1, offset: 0 },
            { unit: "degC", scaleFactor: 1, offset: 273.15 },
          ],
        },
        {
          name: "length",
          label: "Length — multiple metric choices in the dropdown.",
          kind: "number",
          value: 0.25,
          defaultValue: 1,
          unit: "m",
          dialog: G,
          unitOptions: [
            { unit: "m", scaleFactor: 1, offset: 0 },
            { unit: "mm", scaleFactor: 0.001, offset: 0 },
            { unit: "cm", scaleFactor: 0.01, offset: 0 },
            { unit: "km", scaleFactor: 1000, offset: 0 },
          ],
        },
      ],
    },
  },
};

/**
 * Stress test: a `required` field with no value and no default — submit should
 * stay disabled until the user fills it in.
 */
export const RequiredFieldGating: Story = {
  args: {
    title: "Set value to enable submit",
    model: {
      className: "Demo.Required",
      fields: [
        { name: "name", label: "Required free-text. Submit is disabled until non-empty.", kind: "string", value: null, dialog: G, unitOptions: [] },
        { name: "count", label: "count", kind: "integer", value: 1, defaultValue: 1, dialog: G, unitOptions: [] },
      ],
    },
  },
};
