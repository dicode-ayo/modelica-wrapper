/**
 * Stories for `<om-parameter-panel>` — the modal wrapper.
 *
 * The host stays interactive (a fake "open" button) so the modal can be
 * toggled and the backdrop / Escape / cancel behaviour is verifiable in
 * Storybook without contriving the open state via a control.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import type { ParameterModel } from "@dicode/omc-client";
import { html, type TemplateResult } from "lit";

import "../src/parameter-form/parameter-panel.component.js";

interface StoryArgs {
  model: ParameterModel;
  title: string;
}

const G = { tab: "General", group: "Parameters" } as const;

const SIM_MODEL: ParameterModel = {
  className: "Demo.Sim",
  fields: [
    {
      name: "startTime",
      label: "startTime",
      kind: "number",
      value: 0,
      defaultValue: 0,
      dialog: G,
      unitOptions: [],
    },
    {
      name: "stopTime",
      label: "Stop time (s).",
      kind: "number",
      value: 1,
      defaultValue: 1,
      dialog: G,
      unitOptions: [],
    },
    {
      name: "method",
      label: "method",
      kind: "enum",
      value: "dassl",
      defaultValue: "dassl",
      enumChoices: ["dassl", "ida", "euler"],
      dialog: G,
      unitOptions: [],
    },
    {
      name: "emit_protected",
      label: "emit_protected",
      kind: "boolean",
      value: false,
      defaultValue: false,
      dialog: G,
      unitOptions: [],
    },
  ],
};

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ParameterPanel",
  parameters: { chromatic: { disableSnapshot: true } },
  render: ({ model, title }: StoryArgs): TemplateResult => {
    // Local toggle: the story owns `open`; the panel is fully controlled
    // by it (matching how the real webview hosts it).
    const openPanel = (): void => {
      const el = document.querySelector("#story-panel") as
        | (HTMLElement & { open: boolean })
        | null;
      if (el) el.open = true;
    };
    const closeReason = (msg: string) => () => {
      console.log(msg);
      const el = document.querySelector("#story-panel") as
        | (HTMLElement & { open: boolean })
        | null;
      if (el) el.open = false;
    };
    return html`
      <button @click=${openPanel}>Open parameter panel</button>
      <om-parameter-panel
        id="story-panel"
        .model=${model}
        title=${title}
        @om-panel-cancel=${closeReason("[cancel]")}
        @om-panel-submit=${(e: Event) => {
          const ev = e as CustomEvent<{
            values: Record<string, unknown>;
          }>;
          console.log("[submit]", ev.detail.values);
          closeReason("[submit-close]")();
        }}
      ></om-parameter-panel>
    `;
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Simulate: Story = {
  args: {
    model: SIM_MODEL,
    title: "Simulate",
  },
};
