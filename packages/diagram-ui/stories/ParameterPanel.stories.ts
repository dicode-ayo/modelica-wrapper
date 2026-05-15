/**
 * Stories for `<om-parameter-panel>` — the modal wrapper.
 *
 * The host stays interactive (a fake "open" button) so the modal can be
 * toggled and the backdrop / Escape / cancel behaviour is verifiable in
 * Storybook without contriving the open state via a control.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/parameter-form/parameter-panel.component.js";

interface StoryArgs {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  title: string;
}

const SIM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    startTime: { type: "number", default: 0 },
    stopTime: { type: "number", default: 1, description: "Stop time (s)." },
    method: {
      type: "string",
      enum: ["dassl", "ida", "euler"],
      default: "dassl",
    },
    emit_protected: { type: "boolean", default: false },
  },
  required: ["startTime", "stopTime", "method", "emit_protected"],
};

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ParameterPanel",
  render: ({ schema, values, title }: StoryArgs): TemplateResult => {
    // Local toggle: the story owns `open`; the panel is fully controlled
    // by it (matching how the real webview hosts it).
    const openPanel = (): void => {
      const el = document.querySelector("#story-panel") as
        | HTMLElement & { open: boolean }
        | null;
      if (el) el.open = true;
    };
    const closeReason = (msg: string) => () => {
      console.log(msg);
      const el = document.querySelector("#story-panel") as
        | HTMLElement & { open: boolean }
        | null;
      if (el) el.open = false;
    };
    return html`
      <button @click=${openPanel}>Open parameter panel</button>
      <om-parameter-panel
        id="story-panel"
        .schema=${schema}
        .values=${values}
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
    schema: SIM_SCHEMA,
    values: {},
    title: "Simulate",
  },
};
